export async function webSearch(query) {
  const q = String(query || '').trim();
  if (!q) return { provider: 'none', results: [] };

  if (process.env.TAVILY_API_KEY) {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query: q,
        search_depth: 'basic',
        include_answer: true,
        max_results: 5
      })
    });
    if (!response.ok) throw new Error(`Tavily search failed: ${response.status}`);
    const data = await response.json();
    return {
      provider: 'tavily',
      answer: data.answer,
      results: (data.results || []).map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.content
      }))
    };
  }

  if (process.env.SERPAPI_KEY) {
    const params = new URLSearchParams({ q, api_key: process.env.SERPAPI_KEY, engine: 'google' });
    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!response.ok) throw new Error(`SerpAPI search failed: ${response.status}`);
    const data = await response.json();
    return {
      provider: 'serpapi',
      answer: data.answer_box?.answer || data.answer_box?.snippet,
      results: (data.organic_results || []).slice(0, 5).map((item) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet
      }))
    };
  }

  return {
    provider: 'none',
    results: [],
    answer: 'No search API key is configured yet.'
  };
}
