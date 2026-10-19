# Gemini is only ever called on the paid tier

On the unpaid tier, Google may use Gemini API prompts to improve its products, and human reviewers may read them. That breaks our privacy promise for Resumes. So the Worker may only use an API key from a Cloud project with an active, prepaid billing account. Promotional credits can be spent on top of that, but never in place of it. Even on the paid tier, Google keeps prompts for up to 55 days for abuse monitoring, though it doesn't train on them. The privacy notice must say this. We rejected the free tier despite the cost saving. We put Vertex AI (zero data retention available) off until the extra setup is justified.

## Consequences

- Never swap in a free or unpaid key "to save money": that quietly breaks the product's core promise.
- Before launch, and after any key rotation, check that the key shows "Paid tier" in AI Studio.
- Don't use Gemini features that store data beyond the request: Files API, explicit caches, Search/Maps grounding, or the Interactions API without `store=false`.
- Don't put Cloudflare AI Gateway or any other proxy that logs prompts by default in the call path.
