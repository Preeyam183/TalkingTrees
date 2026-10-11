import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler,HTTPServer
from urllib.error import HTTPError
from treequest_bridge import decode_packet,live_payload,post

DEVICE='50000000-0000-4000-8000-000000000001'
TREE='40000000-0000-4000-8000-000000000001'
def packet(raw=280,temp=23.5):
 return {'device_id':'arduino-01','seq':1,'adc_raw':raw,'moisture_raw':(raw*65535+511)//1023,'air_temperature_c':temp,'soil_temperature_c':None,'light_raw':None}

class BridgeTests(unittest.TestCase):
 def test_calibration_directions_and_schema(self):
  p=live_payload(packet(),DEVICE,TREE,150,800)
  self.assertEqual(p['soil_moisture_pct'],20)
  self.assertEqual(set(p),{'device_id','tree_id','external_event_id','timestamp','soil_moisture_pct','temperature_c'})
  self.assertEqual(live_payload(packet(475),DEVICE,TREE,800,150)['soil_moisture_pct'],50)
 def test_missing_temperature_not_fabricated(self):
  for temp in [None,True,float('nan'),90]:
   with self.assertRaises(ValueError):live_payload(packet(temp=temp),DEVICE,TREE,150,800)
 def test_raw_packet_validation(self):
  self.assertEqual(decode_packet(json.dumps(packet()),'arduino-01')['adc_raw'],280)
  bad=packet();bad['moisture_raw']=18000
  with self.assertRaises(ValueError):decode_packet(json.dumps(bad),'arduino-01')
  with self.assertRaises(ValueError):decode_packet(json.dumps(packet()),'another-device')
 def test_endpoint_refs_and_clamping(self):
  with self.assertRaises(ValueError):live_payload(packet(),DEVICE,TREE,150,155)
  self.assertEqual(live_payload(packet(100),DEVICE,TREE,150,800)['soil_moisture_pct'],0)
  self.assertEqual(live_payload(packet(900),DEVICE,TREE,150,800)['soil_moisture_pct'],100)
 def test_http_auth_route_and_identical_retry_payload(self):
  received=[]
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_POST(self):
    received.append((self.path,self.headers.get('X-Device-Key'),self.headers.get('apikey'),self.rfile.read(int(self.headers['Content-Length']))))
    self.send_response(503 if len(received)==1 else 200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"status":"healthy"}')
  server=HTTPServer(('127.0.0.1',0),Handler)
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   url='http://127.0.0.1:'+str(server.server_port)+'/functions/v1/api'
   payload=json.dumps(live_payload(packet(),DEVICE,TREE,150,800))
   with self.assertRaises(HTTPError):post(url,'test-secret','test-public',payload)
   self.assertEqual(post(url,'test-secret','test-public',payload)['status'],'healthy')
   self.assertEqual(received[0],received[1]);self.assertEqual(received[0][0],'/functions/v1/api/sensor-readings')
   self.assertEqual(received[0][1:3],('test-secret','test-public'))
  finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
