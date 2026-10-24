import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from service_lifecycle import ServiceLifecycle
class Tests(unittest.TestCase):
    def test_busy_service_cannot_be_reserved(self):
        life=ServiceLifecycle()
        with life.request():
            self.assertEqual(life.status()['activeRequests'],1)
            with self.assertRaises(RuntimeError):life.prepare()
        self.assertEqual(life.status()['activeRequests'],0)
    def test_reservation_blocks_new_requests_until_cancel(self):
        life=ServiceLifecycle();reservation=life.prepare()
        with self.assertRaises(RuntimeError):
            with life.request():pass
        with self.assertRaises(RuntimeError):life.prepare()
        with self.assertRaises(RuntimeError):life.cancel('another-owner')
        life.cancel(reservation['token'])
        with life.request():self.assertEqual(life.status()['activeRequests'],1)
    def test_exception_releases_counter_and_abandoned_reservation_expires(self):
        life=ServiceLifecycle()
        with self.assertRaises(ValueError):
            with life.request():raise ValueError('test')
        self.assertEqual(life.status()['activeRequests'],0)
        life.prepare();life.reserved_until=0
        with life.request():pass
if __name__=='__main__':unittest.main()
