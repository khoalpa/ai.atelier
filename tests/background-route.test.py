"""Exercise the actual AI HTTP handler with an isolated source and injected segmenter."""
import io,json,sys,tempfile,unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import services.ai.http as ai_service
class RouteTests(unittest.TestCase):
    def test_new_cutout_endpoint_and_input_validation(self):
        saved_root,saved_segment=ai_service.ROOT,ai_service.birefnet_mask
        try:
            with tempfile.TemporaryDirectory() as folder:
                ai_service.ROOT=Path(folder);directory=Path(folder)/'workspace/manual/assets';directory.mkdir(parents=True)
                Image.new('RGB',(32,24),'white').save(directory/('a'*64+'.png'))
                ai_service.birefnet_mask=lambda image:Image.new('L',image.size,255)
                class Request:
                    path='/manual-cutout'
                    def reply(self,status,value):self.status,self.result=status,value
                for source,expected in [('/manual-assets/'+('a'*64)+'.png',200),('/manual-assets/../../outside.png',400)]:
                    body=json.dumps({'asset':source}).encode();request=Request();request.headers={'Host':f'127.0.0.1:{ai_service.PORT}','Content-Length':str(len(body))};request.rfile=io.BytesIO(body)
                    ai_service.Handler.do_POST(request)
                    self.assertEqual(request.status,expected,request.result)
                    if expected==200:self.assertEqual(request.result['width'],32)
        finally:ai_service.ROOT,ai_service.birefnet_mask=saved_root,saved_segment
if __name__=='__main__':unittest.main()
