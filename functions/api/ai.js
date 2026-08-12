export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const { prompt, code } = await request.json();

    if (!env.AI) {
      return new Response(JSON.stringify({ error: "AI binding not configured. Bind an AI model in Cloudflare Pages settings." }), { status: 500 });
    }

    const fullPrompt = `### Instruction:\n${prompt}\n\n### Code:\n${code}\n\n### Response:\n`;
    
    // SWITCHED TO GLM-5.2
    const aiResponse = await env.AI.run('@cf/zai/glm-5.2', {
      prompt: fullPrompt,
      max_tokens: 1024
    });

    return new Response(JSON.stringify({ response: aiResponse.response }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
