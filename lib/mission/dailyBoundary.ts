/** Find the next local calendar date without assuming every day has 24 hours. */
export function nextBudgetDay(timezone: string, now = Date.now()) {
  const format = new Intl.DateTimeFormat("en-CA", {timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"});
  const date = format.format(now); let low = now, high = now + 30*3600000;
  while (high-low>1000) {const mid=Math.floor((low+high)/2);if(format.format(mid)===date)low=mid;else high=mid;}
  return new Date(Math.ceil(high/1000)*1000);
}
