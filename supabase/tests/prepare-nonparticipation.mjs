import {readFile,writeFile} from 'node:fs/promises';
import {validateScoringImport} from './scoring-import.mjs';
import {CONFIRMATION_ID} from './scoring-nonparticipation.mjs';
try{
 const [input,output,...extra]=process.argv.slice(2);
 if(!input||!output||extra.length)throw Error('Use ORIGINAL_IMPORT_FILE NEW_CORRECTION_FILE');
 const original=JSON.parse(await readFile(input,'utf8'));
 validateScoringImport(original);
 const correction={...structuredClone(original),observed_at:new Date().toISOString(),expected_revision:original.expected_revision+1,reason:'Audited commissioner confirmation of specific historical non-participation; original Fantrax blanks preserved',non_participation_confirmation:{id:CONFIRMATION_ID,original_envelope:original}};
 validateScoringImport(correction);
 await writeFile(output,JSON.stringify(correction,null,2),{flag:'wx'});
 console.log('Created correction evidence. Preview with import-scoring.mjs before applying; no database changes made.');
}catch(e){console.error(e.name==='ScoringImportError'?e.message:'Could not prepare correction. Check arguments and original file; output must not already exist.');process.exitCode=1;}
