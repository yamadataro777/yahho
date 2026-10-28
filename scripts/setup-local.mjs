import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const path=fileURLToPath(new URL('../.dev.vars',import.meta.url));
if(!existsSync(path)){
 const token=()=>randomBytes(36).toString('base64url');
 writeFileSync(path,`# Local development only; never commit or reuse in production.\nADMIN_TOKEN=${token()}\nCONVERSION_TOKEN=${token()}\n`,{flag:'wx',mode:0o600});
 console.log('Local development tokens created in ignored .dev.vars. Values are not printed.');
}else console.log('Existing .dev.vars preserved.');
