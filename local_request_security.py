"""Reject browser requests from other sites before taking the inference lock."""
from functools import wraps


def trusted_request(port):
    def decorate(function):
        @wraps(function)
        def wrapped(self):
            host = str(self.headers.get('Host', '')).lower()
            origin = self.headers.get('Origin')
            if (host not in {f'127.0.0.1:{port}', f'localhost:{port}'}
                    or self.headers.get('Sec-Fetch-Site') == 'cross-site'
                    or (origin and origin != f'http://{host}')):
                self.close_connection = True
                # Drain only a small, promptly available body so Windows can
                # deliver the 403 instead of resetting a socket with unread data.
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    length = 0
                if 0 < length <= 65536:
                    previous_timeout = self.connection.gettimeout()
                    try:
                        self.connection.settimeout(0.25)
                        self.rfile.read(length)
                    except (OSError, ValueError):
                        pass
                    finally:
                        self.connection.settimeout(previous_timeout)
                return self.reply(403, {'ok': False, 'error': 'Yêu cầu phải đến từ ứng dụng này.'})
            return function(self)
        return wrapped
    return decorate
