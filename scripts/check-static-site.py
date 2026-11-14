#!/usr/bin/env python3
"""Validate the dependency-free project site without starting the application."""
from html.parser import HTMLParser
from pathlib import Path
import argparse
import json
import re
from urllib.parse import urlsplit, unquote

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--site-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'static-site')
parser.add_argument('--base-url', default='https://www.murdawkmedia.com/openstays/')
args = parser.parse_args()
ROOT = args.site_dir.resolve()
ORIGIN = args.base_url
assert ORIGIN.startswith('https://') and ORIGIN.endswith('/'), 'Use a complete HTTPS base URL ending in /'


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path, self.ids, self.links, self.resources = path, set(), [], []
        self.h1 = 0
        self.canonical = []
        self.jsonld = []
        self.social_images = []
        self.script = None
        self.text = []
        self.feed(path.read_text())
        self.close()
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if 'id' in a:
            assert a['id'] not in self.ids, f'{self.path}: duplicate id {a["id"]}'
            self.ids.add(a['id'])
        if tag == 'html':
            assert a.get('lang') == 'en', f'{self.path}: missing English language'
            assert 'data-openstays-static' in a, f'{self.path}: missing static importer marker'
        if tag == 'h1': self.h1 += 1
        if tag == 'meta' and a.get('property') == 'og:image': self.social_images.append(a.get('content', ''))
        if tag == 'a' and 'href' in a: self.links.append(a['href'])
        if tag == 'link' and a.get('rel') == 'canonical': self.canonical.append(a.get('href'))
        if tag == 'script':
            assert a.get('type') == 'application/ld+json' and 'src' not in a, f'{self.path}: executable script'
            self.script = ''
        assert tag not in ('form', 'iframe', 'object', 'embed'), f'{self.path}: active service surface {tag}'
        if 'src' in a: self.resources.append(a['src'])
        if tag == 'link' and a.get('rel') in ('stylesheet', 'icon', 'preload'):
            self.resources.append(a.get('href', ''))
    def handle_data(self, data):
        if self.script is not None: self.script += data
        else: self.text.append(data)
    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            self.jsonld.append(json.loads(self.script))
            self.script = None

paths = [ROOT / 'index.html', ROOT / 'hosting/index.html']
pages = {p: Page(p) for p in paths}
for path, page in pages.items():
    rel = path.relative_to(ROOT).as_posix().removesuffix('index.html')
    assert page.h1 == 1, f'{path}: must have exactly one h1'
    assert page.canonical == [ORIGIN + rel], f'{path}: incorrect canonical'
    assert len(' '.join(page.text).split()) > 300, f'{path}: missing server-readable content'
    for href in page.links + page.resources:
        url = urlsplit(href)
        if href in page.resources: assert not url.scheme and not url.netloc, f'{path}: remote runtime resource {href}'
        if url.scheme or url.netloc:
            assert url.scheme == 'https' and url.netloc, f'{path}: unsafe external link {href}'
            continue
        target = (path.parent / unquote(url.path)).resolve() if url.path else path
        if url.path.startswith(urlsplit(ORIGIN).path):
            target = ROOT / url.path.removeprefix(urlsplit(ORIGIN).path)
        if target.is_dir(): target /= 'index.html'
        assert target.is_relative_to(ROOT), f'{path}: resource escapes static site: {href}'
        assert target.exists(), f'{path}: broken local link {href}'
        if url.fragment and target.suffix == '.html':
            assert unquote(url.fragment) in pages[target].ids, f'{path}: broken anchor {href}'
    assert page.social_images == [ORIGIN + 'social.png'], f'{path}: incorrect social image URL'
    assert (ROOT / 'social.png').read_bytes()[:8] == b'\x89PNG\r\n\x1a\n', 'Missing social PNG'
    for css in ROOT.glob('*.css'):
        assert not re.search(r'@import|url\(\s*[\'"]?(?:https?:|//)', css.read_text()), f'{css}: remote CSS dependency'
    for schema in page.jsonld:
        assert schema.get('@context') == 'https://schema.org', f'{path}: incorrect schema context'

home = pages[ROOT / 'index.html']
graph = home.jsonld[0]['@graph']
assert any(node['@type'] == 'SoftwareSourceCode' and node['license'].endswith('/LICENSE') for node in graph)
faq = next(node for node in graph if node['@type'] == 'FAQPage')
visible = re.sub(r'\s+', ' ', ' '.join(home.text))
for entry in faq['mainEntity']:
    assert entry['name'] in visible, f'FAQ question not visible: {entry["name"]}'
    assert entry['acceptedAnswer']['text'] in visible, f'FAQ answer not visible: {entry["name"]}'
assert len(faq['mainEntity']) >= 5
assert not re.search(r'https://[a-z0-9-]+\.convex\.(?:cloud|site)', ''.join(p.read_text() for p in paths)), 'Live backend URL in static output'
print(f'Static site contracts pass: {len(pages)} HTML pages, {len(faq["mainEntity"])} visible structured answers, local assets and links, no executable scripts or remote runtime resources.')
