"""
One chat call to whichever model the owner configures.

Provider-neutral on purpose: it speaks the OpenAI-style chat-completions
format (POST {base}/chat/completions), which most providers accept. Switching
provider is three env values, no code change:

    Provider        BHAAI_LLM_BASE_URL                                          BHAAI_LLM_MODEL (example)
    OpenAI          https://api.openai.com/v1                                   gpt-4o-mini
    Groq            https://api.groq.com/openai/v1                              llama-3.1-8b-instant
    Google Gemini   https://generativelanguage.googleapis.com/v1beta/openai     gemini-2.0-flash
    OpenRouter      https://openrouter.ai/api/v1                                (any model id it lists)
    Local (Ollama)  http://localhost:11434/v1                                   llama3.1

BHAAI_LLM_API_KEY holds the key. It stays in backend env; nothing here sends
it to the browser, and it is never logged.

Some newer models reject `max_tokens` and want `max_completion_tokens`; set
BHAAI_LLM_MAX_TOKENS_PARAM for those.
"""
import os

import requests

DEFAULT_BASE_URL = 'https://api.openai.com/v1'
DEFAULT_TIMEOUT = 25   # seconds; a slow provider must not hold a worker for long


class LLMNotConfigured(Exception):
    """No key or no model in env: the feature is simply not switched on."""


class LLMError(Exception):
    """The provider failed or answered with something unusable."""


def settings():
    return {
        'base_url': (os.environ.get('BHAAI_LLM_BASE_URL') or DEFAULT_BASE_URL).rstrip('/'),
        'api_key': os.environ.get('BHAAI_LLM_API_KEY') or '',
        'model': os.environ.get('BHAAI_LLM_MODEL') or '',
        'max_tokens_param': os.environ.get('BHAAI_LLM_MAX_TOKENS_PARAM') or 'max_tokens',
        'timeout': float(os.environ.get('BHAAI_LLM_TIMEOUT') or DEFAULT_TIMEOUT),
    }


def is_configured():
    s = settings()
    return bool(s['api_key'] and s['model'])


def model_name():
    return settings()['model'] or None


def chat(messages, max_tokens, temperature=0.2):
    """Send `messages` ([{role, content}]) and return (text, usage).

    usage is {'input_tokens': int|None, 'output_tokens': int|None}. Raises
    LLMNotConfigured when the env is incomplete, LLMError for anything the
    provider does wrong, including a timeout.
    """
    s = settings()
    if not (s['api_key'] and s['model']):
        raise LLMNotConfigured('Set BHAAI_LLM_API_KEY and BHAAI_LLM_MODEL.')

    body = {
        'model': s['model'],
        'messages': messages,
        'temperature': temperature,
        s['max_tokens_param']: max_tokens,
    }
    try:
        resp = requests.post(
            f"{s['base_url']}/chat/completions",
            headers={'Authorization': f"Bearer {s['api_key']}",
                     'Content-Type': 'application/json'},
            json=body,
            timeout=s['timeout'],
        )
    except requests.RequestException as e:
        raise LLMError(f'request failed: {type(e).__name__}') from e

    if resp.status_code != 200:
        # The body can echo the request; keep only the status and a short head.
        raise LLMError(f'provider returned {resp.status_code}: {resp.text[:200]}')

    try:
        data = resp.json()
        text = data['choices'][0]['message']['content']
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise LLMError('unexpected response shape') from e
    if not isinstance(text, str) or not text.strip():
        raise LLMError('empty reply')

    usage = data.get('usage') or {}
    return text.strip(), {
        'input_tokens': usage.get('prompt_tokens'),
        'output_tokens': usage.get('completion_tokens'),
    }
