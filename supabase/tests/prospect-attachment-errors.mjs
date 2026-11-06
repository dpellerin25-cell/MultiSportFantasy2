// Only known validation messages; never echo arbitrary SQL, connection or file errors.
export function prospectAttachmentIssue(error){
 const message=String(error?.message??'');
 const exact=new Set([
  'Only an unstarted Cup 2027 startup draft may receive this catalogue',
  'Invalid prospect identity mappings',
  'Existing verified prospect identity cannot be replaced',
  'Verified mapping must identify a player in the same sport',
  'Draft not found','Preview changed; run preview again',
 ]);
 if(exact.has(message))return message;
 if(/^Review possible Fantrax duplicate for catalogue startup-2027-\d{3} before attachment$/.test(message))return message;
 if(/^(Mapped Fantrax player is not in this available draft pool|Prospect is already owned): startup-2027-\d{3}$/.test(message))return message;
 return 'Check project settings, unstarted draft and identity conflicts. Unexpected error details withheld to protect credentials.';
}
