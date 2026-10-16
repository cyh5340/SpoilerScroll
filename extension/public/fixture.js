const params=new URLSearchParams(location.search);
const story=params.get('story'),history=params.get('history');
if(/^fixture-[1-3]$/.test(story||'') || /^[1-3]$/.test(history||'')) {
  document.querySelector('h1').textContent=story?'You chose to keep reading.':'A page from your simulated history.';
  document.querySelector('.lede').textContent='This is a local demonstration destination. No real article was fetched.';
  for(const card of document.querySelectorAll('article'))if(card.id!==story)card.remove();
  document.querySelector('.note').textContent='Use the SpoilerScroll link above to return to the feed.';
}
