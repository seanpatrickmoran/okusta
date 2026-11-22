"""Import, interact and reload the actual unpacked extension in a temporary Chromium profile."""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]

def check(executable):
    dist = ROOT/'dist/chrome'
    fixture = ROOT/'examples/tabs.okusta-replay.json'
    with TemporaryDirectory() as profile, sync_playwright() as pw:
        options = {'executable_path':executable} if executable else {'channel':'chromium'}
        ctx = pw.chromium.launch_persistent_context(profile, headless=True,
              args=[f'--disable-extensions-except={dist}',f'--load-extension={dist}'], **options)
        try:
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
            page = ctx.new_page()
            page.goto(worker.url.rsplit('/',1)[0]+'/desk.html')
            page.locator('#replay-file').set_input_files(fixture)
            card = page.locator('.replay-card')
            frame = card.frame_locator('iframe')
            step = card.get_by_role('button',name='Step',exact=True)
            for i in range(2):
                expect(frame.locator('#out')).to_have_text('Details 2')
                step.click()
                expect(card.get_by_role('status')).to_have_text('Reproduced')
                expect(frame.locator('#active')).to_have_text('')
                if not i:
                    card.get_by_role('button',name='Reset').click()
            frame.locator('#three').click()
            expect(card.get_by_role('status')).to_contain_text('Explore')
            expect(step).to_be_disabled()
            page.reload()
            card.locator('summary').click()
            expect(frame.locator('#out')).to_have_text('Details 2')
            # A valid trace whose recorded mismatch differs from the pinned live widget.
            alt = json.loads(fixture.read_text())
            alt['id']+='-different'; alt['verification']['candidate']['actual']='one'
            page.locator('#replay-file').set_input_files({'name':'different.json','mimeType':'application/json','buffer':json.dumps(alt).encode()})
            other = page.locator('article').filter(has_text='Recorded submission').first
            other.get_by_role('button',name='Step',exact=True).click()
            expect(other.locator('.replay-card [role=status]')).to_have_text('Diverged')
            print('Chromium extension passed import, Step, Reset, Explore, persistence and divergence.')
        finally:
            ctx.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--executable',help='Chromium with unpacked-extension support')
    check(parser.parse_args().executable)
