import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
test('generated catalogue runtime matches its reviewed pinned manifest',()=>{
 const base=new URL('./catalogue-runtime/',import.meta.url);
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
 assert.match(manifest.app_commit,/^[a-f0-9]{40}$/);
 assert.ok(Object.keys(manifest.generated_files).length>=20);
 for(const [name,hash]of Object.entries(manifest.generated_files)){
  assert.equal(createHash('sha256').update(readFileSync(new URL(name+'.ts',base))).digest('hex'),hash,name);
 }
});
