"""Exercise a collection card through the installed Chromium extension."""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]

def check(executable):
    fixture = ROOT/'examples/collection.okusta-replay.json'
    record = json.loads(fixture.read_text())
    dist = ROOT/'dist/chrome'
    options = {'executable_path':executable} if executable else {'channel':'chromium'}
    with TemporaryDirectory() as profile, sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(profile, headless=True, **options,
            args=[f'--disable-extensions-except={dist}',f'--load-extension={dist}'])
        try:
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
            page = ctx.new_page()
            page.goto(worker.url.rsplit('/',1)[0]+'/desk.html')
            empty_icon = page.locator('#empty img')
            expect(empty_icon).to_be_visible()
            empty_icon.evaluate('(img) => img.decode()')
            assert empty_icon.evaluate('(img) => img.naturalWidth === 128 && img.width === 128 && img.height === 128')
            page.locator('#replay-file').set_input_files(fixture)
            expect(empty_icon).to_be_hidden()
            card = page.locator('.collection-replay')
            step = card.get_by_role('button',name='Step',exact=True)
            for event in record['steps']:
                step.click()
                if event['action']['op']=='open' and len(event['observation']['members'])==2:
                    expect(card.locator('section')).to_contain_text('Missing from the save request')
            expect(card.locator('section')).to_contain_text('Verified completion')
            expect(step).to_be_disabled()
            card.get_by_role('button',name='Reset').click()
            expect(step).to_be_enabled()
            page.reload()
            expect(empty_icon).to_be_hidden()
            if not card.evaluate('(e) => e.open'):
                card.locator(':scope > summary').click()
            expect(card.get_by_role('status')).to_contain_text('Ready')
        finally:
            ctx.close()

if __name__=='__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--executable')
    check(p.parse_args().executable)
