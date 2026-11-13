"""One release/browser check of the public reader, never a card-update prerequisite."""
import json
from pathlib import Path
from urllib.request import Request,urlopen

ROOT=Path(__file__).parents[1]


def main():
    config=json.loads((ROOT/'site/race-results-config.json').read_text())
    origin='https://itaingtr.github.io'
    endpoint=config['endpoint']
    preflight=Request(endpoint,method='OPTIONS',headers={'Origin':origin,
        'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,apikey'})
    with urlopen(preflight,timeout=20) as response:
        assert response.status==204
        assert response.headers.get('Access-Control-Allow-Origin')==origin
    from urllib.parse import urlencode
    source='https://keirin.kdreams.jp/tachikawa/racedetail/2820261112010007/'
    request=Request(endpoint+'?'+urlencode({'source':source}),headers={
        'Origin':origin,'Authorization':'Bearer '+config['anon_key'],'apikey':config['anon_key']})
    with urlopen(request,timeout=25) as response:
        assert response.headers.get('Access-Control-Allow-Origin')==origin
        data=json.load(response)
    assert data['schema_version']==1 and data['source_url']==source and data['race_id']=='072820261112'
    assert len(data['rows'])==9
    assert data['rows'][0]['rank']=='1' and data['rows'][0]['no']==1 and data['rows'][0]['name']=='湊聖二'
    assert data['rows'][0]['time']=='11.8' and data['rows'][0]['reason']=='直線伸びて'
    assert {'combination':'1-5','yen':3760} in data['payouts']['exacta']
    assert {'combination':'1-5-6','yen':63040} in data['payouts']['trifecta']
    print('LIVE RESULT PASS: anonymous JWT/CORS, exact race, 9 placings, accident rows, time/reason, 2車単3760円 / 3連単63040円; no database writes')


if __name__=='__main__':main()
