from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from test_service import desk

class ReplayStorageTests(unittest.TestCase):
    def test_concurrent_import_copy_and_branch(self):
        record = json.loads((Path(__file__).resolve().parents[1]/'examples/tabs.okusta-replay.json').read_text())
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp)/'journal.sqlite')
            desk.database('open',{'path':path})
            def write(i):
                value = dict(id='replay-test',kind='replay',createdAt=str(i),replay=record)
                desk.database('write',{'path':path,'records':{'clip:replay-test':value}})
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(write,range(8)))
            stored = desk.database('read',{'path':path})['clip:replay-test']
            renamed = {**stored, "replay": {**record, "format": "zerkalo-replay/1"}}
            desk.database('open', {'path':path, 'records':{'clip:replay-test':renamed}})
            with self.assertRaises(ValueError):
                desk.database('write',{'path':path,'records':{'clip:replay-test':{**stored,'replay':{**record,'title':'changed'}}}})
            self.assertEqual(stored,desk.database('read',{'path':path})['clip:replay-test'])
            branch='a'*32
            desk.database('split',{'path':path,'id':'replay-test','stamp':{'id':branch}})
            self.assertEqual(desk.database('read',{'path':path})['clip:'+branch]['replay'],record)
            dest=str(Path(tmp)/'copy.sqlite')
            desk.database('open',{'path':dest,'records':desk.database('read',{'path':path})})
            desk.database('delete',{'path':dest,'id':branch})
            self.assertEqual(desk.database('read',{'path':dest}),{'clip:replay-test':stored})
