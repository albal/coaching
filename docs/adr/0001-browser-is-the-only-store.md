# The browser is the only store of user content

The product promises that nothing a user uploads or generates is kept. So the Cloudflare Worker is stateless. The Resume, Job Descriptions, Reports and Coaching Chat history live only in the page's memory, and the page sends whatever context each request needs. Closing the tab is the deletion: there's nothing on the server to clean up. We chose this over a Durable Object per Session and over KV/R2 with a TTL. Those would have needed deletion triggers, a sweeper and proof that deletion worked, all to save re-sending a few KB of Resume text with each request.

## Consequences

- No server-side session store, cookie-keyed state or file uploads. Files are converted to text in the browser.
- A page refresh loses the Session. The page warns before unload, and `sessionStorage`/`localStorage` are deliberately not used.
- The only persistent server-side data is the content-free daily usage counter used for the AI cost cap.
- Google Gemini still processes the text (see the privacy notice), so "nothing stored" means nothing stored *by this site*.
