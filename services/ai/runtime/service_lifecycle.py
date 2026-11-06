"""Track in-flight requests and reserve an idle service for a controlled restart."""
import threading
import time
import uuid
from contextlib import contextmanager


class ServiceLifecycle:
    def __init__(self):
        self.lock = threading.Lock()
        self.active = 0
        self.reserved_until = 0
        self.token = None

    def status(self):
        with self.lock:
            return {"activeRequests": self.active, "maintenance": time.monotonic() < self.reserved_until}

    @contextmanager
    def request(self):
        with self.lock:
            if time.monotonic() < self.reserved_until:
                raise RuntimeError("Dịch vụ AI đang khởi động lại. Hãy thử lại sau ít giây.")
            self.active += 1
        try:
            yield
        finally:
            with self.lock:
                self.active -= 1

    def prepare(self):
        with self.lock:
            if self.active:
                raise RuntimeError("Còn thao tác AI đang xử lý. Đợi hoàn tất trước khi khởi động lại.")
            if time.monotonic() < self.reserved_until:
                raise RuntimeError("Dịch vụ AI đang được khởi động lại ở cửa sổ khác.")
            self.reserved_until = time.monotonic() + 120
            self.token = uuid.uuid4().hex
            return {"ok": True, "maintenance": True, "token": self.token}

    def cancel(self, token=None):
        with self.lock:
            if self.token and token != self.token:
                raise RuntimeError("Phiên khởi động lại không khớp.")
            self.reserved_until = 0
            self.token = None
        return {"ok": True, "maintenance": False}
