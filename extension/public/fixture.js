const story=new URLSearchParams(location.search).get('story');
if(/^fixture-[1-5]$/.test(story||'')) {
  document.querySelector('h1').textContent='You chose to keep reading.';
  document.querySelector('.lede').textContent='This is a local demonstration destination. No real article was fetched.';
  for(const card of document.querySelectorAll('article'))if(card.id!==story)card.remove();
  document.querySelector('.note').textContent='Use the SpoilerScroll link above to return to the feed, or reset the demo to start again.';
}
