"""Bounded public-source reads. No K Dreams requests, login, or hidden credentials."""
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import re
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

HOSTS = {'www.winticket.jp', 'www.yen-joy.net'}


def check_url(url):
    p = urlsplit(url)
    if p.scheme != 'https' or p.hostname not in HOSTS or p.username or p.password or p.port:
        raise ValueError('Only the configured public source hosts are allowed')
    return url


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.children, self.parent = tag, dict(attrs), [], parent

    def text(self):
        return ''.join(c if isinstance(c, str) else c.text() for c in self.children)

    def visible_text(self):
        if self.tag in ('script', 'style'):
            return ''
        return ' '.join(c if isinstance(c, str) else c.visible_text() for c in self.children)

    def find_all(self, tag=None):
        for c in self.children:
            if isinstance(c, Node):
                if tag is None or c.tag == tag:
                    yield c
                yield from c.find_all(tag)


class Document(HTMLParser):
    VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs, self.stack[-1]))

    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def fetch(url, sources):
    check_url(url)
    request = Request(url, headers={'User-Agent': 'KeirinLineup2/1.0 (+https://github.com/itaingtr/keirin-lineup)'})
    with build_opener(SafeRedirect()).open(request, timeout=40) as response:
        check_url(response.url)
        raw = response.read(6_000_001)
        if len(raw) > 6_000_000:
            raise ValueError('Source response exceeds the size limit')
        text = raw.decode(response.headers.get_content_charset() or 'utf-8')
    sources.append({'url':url, 'observed_at':datetime.now(timezone.utc).isoformat(), 'raw_html':text})
    return Document(text).root, sources[-1]['observed_at']


def cells(row):
    return [n for n in row.children if isinstance(n, Node) and n.tag in ('td','th')]


def state_payloads(doc):
    """Only decode JSON data; never evaluate source JavaScript."""
    for node in doc.find_all('script'):
        text = node.text().strip()
        if node.attrs.get('type') == 'application/json':
            try:
                yield json.loads(text)
            except ValueError:
                pass
        for match in re.finditer(r'window\.__PRELOADED_STATE__\s*=\s*', text):
            try:
                value = json.JSONDecoder().raw_decode(text[match.end():])[0]
                if isinstance(value, (dict,list)):
                    yield value
            except ValueError:
                pass
