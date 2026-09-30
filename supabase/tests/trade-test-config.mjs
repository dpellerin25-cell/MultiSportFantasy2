export function localTradeTestConfig(raw){
  let url;
  try{url=new URL(raw);}catch{throw new Error('Set LOCAL_TRADE_TEST_DB_URL to an empty localhost *_trade_test database.');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||url.hash||!/^\/[a-z0-9_]+_trade_test$/.test(url.pathname)||!url.username||!url.password)
    throw new Error('Only a local disposable *_trade_test database with explicit credentials and no URL overrides is allowed.');
  return {connectionString:raw,connectionTimeoutMillis:5000};
}
