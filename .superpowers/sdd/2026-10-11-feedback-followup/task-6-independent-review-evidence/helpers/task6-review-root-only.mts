import {savedRecoveryFixture} from '/private/tmp/ccloop-feedback-followup-20261011/tests/control/savedRecoveryFixture.ts';
import {readSavedResultEligibility} from '/private/tmp/ccloop-feedback-followup-20261011/src/control/savedResultRecovery.ts';
import {chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
const f=await savedRecoveryFixture();try{console.log('baseline',await readSavedResultEligibility(f.input));
await chmod(join(f.sourceDir,'control'),0o777);console.log('0777 fence directory',await readSavedResultEligibility(f.input));
await chmod(join(f.sourceDir,'input'),0o777);console.log('0777 input parent',await readSavedResultEligibility(f.input));}
finally{await rm(f.root,{recursive:true,force:true});}
