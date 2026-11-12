from pathlib import Path
from xml.etree import ElementTree as E
import difflib
p=Path(__file__).resolve().parents[2]/'test-runs'/'1.0.0'/'test-word-smoke-100'
ns={'p':'http://schemas.microsoft.com/office/2006/xmlPackage'}
def extract(name):
    root=E.parse(p/name)
    node=root.find('.//p:part[@p:name="/word/document.xml"]/p:xmlData',ns)
    return E.tostring(node,encoding='unicode').replace('><','>\n<').splitlines()
print('\n'.join(difflib.unified_diff(extract('before.xml'),extract('after.xml'),n=1)))
