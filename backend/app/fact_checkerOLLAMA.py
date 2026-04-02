import os
import re
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv, find_dotenv
from tavily import TavilyClient
try:
    from langchain_ollama import ChatOllama
except ImportError:
    # Fallback to deprecated import if new package not installed
    from langchain_community.chat_models import ChatOllama
from langchain_core.prompts import PromptTemplate
import httpx
from .source_allowlist import ALLOWED_SOURCE_DOMAINS, filter_allowed_source_results

load_dotenv(find_dotenv(usecwd=True) or Path(__file__).resolve().parents[2] / ".env")

_llm: Optional[ChatOllama] = None
_search: Optional[TavilyClient] = None

def _ensure_tavily_search() -> TavilyClient:
    global _search
    if _search is not None:
        return _search
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Missing Tavily credentials: TAVILY_API_KEY. "
            "Set them in your environment or .env file."
        )
    _search = TavilyClient(api_key=api_key)
    return _search


def _run_tavily_search(search: TavilyClient, query: str, max_results: int = 5):
    response = search.search(
        query=query,
        search_depth="basic",
        max_results=max_results,
        include_domains=ALLOWED_SOURCE_DOMAINS,
    )
    if not isinstance(response, dict):
        return []
    results = response.get("results")
    if not isinstance(results, list):
        return []
    return filter_allowed_source_results(results)

def _check_ollama_connection(base_url: str) -> bool:
    """Check if Ollama is running and accessible."""
    try:
        response = httpx.get(f"{base_url}/api/tags", timeout=5.0)
        return response.status_code == 200
    except Exception:
        return False

def _ensure_llm() -> ChatOllama:
    global _llm
    if _llm is not None:
        return _llm
    model = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
    configured_host = os.getenv("OLLAMA_BASE_URL") or os.getenv("OLLAMA_HOST")
    if configured_host:
        base_url = configured_host if configured_host.startswith("http") else f"http://{configured_host}"
    else:
        base_url = "http://localhost:11434"
    
    # Check if Ollama is running
    if not _check_ollama_connection(base_url):
        raise RuntimeError(
            f"Ollama is not running or not accessible at {base_url}. "
            "Please make sure Ollama is installed and running. "
            "You can start it by running 'ollama serve' or ensure it's running in the background."
        )
    
    try:
        temperature = float(os.getenv("LLM_TEMPERATURE", "0.1"))
    except ValueError:
        raise RuntimeError("LLM_TEMPERATURE must be a number if set.")
    
    print(f"Connecting to Ollama at {base_url} with model: {model}")
    _llm = ChatOllama(
        model=model,
        base_url=base_url,
        temperature=temperature,
        keep_alive="5m",
        timeout=120.0,  # 2 minute timeout for model responses
    )
    return _llm

# III. The Reasoning Prompt Template
RAG_PROMPT_TEMPLATE = """
**FACT-CHECKER ASSIGNMENT: RAG Fake News Detector**

You are an objective, expert fact-checker. Your task is to analyze a user's query against
the real-time evidence retrieved from Tavily Search.

**1. QUERY/CLAIM TO VERIFY:**
{query}

**2. RETRIEVED EVIDENCE (Search Results):**
{search_results}

**INSTRUCTIONS FOR REASONING:**
A. **Classification:** Determine the veracity of the QUERY.
   - If the search results overwhelmingly confirm the claim, classify it as **REAL**.
   - If the search results **contradict** or **cannot find any corroborating information** for the claim, classify it as **FAKE**.
B. **Reasoning:** Your explanation must explicitly reference the information found in the **RETRIEVED EVIDENCE** section using IEEE-style inline citations. For each source you reference, use [1], [2], [3], etc. in square brackets. The numbering should correspond to the order of sources in the Evidence list below. Do NOT include URLs, the word "EVIDENCE", or evidence sections in your reasoning text.

**FINAL OUTPUT FORMAT:**
Classification: [REAL or FAKE]
Reasoning: [Provide a concise, detailed, and evidence-based explanation with IEEE-style citations like [1], [2], [3] where you reference sources. Do NOT include URLs, evidence sections, or the word "EVIDENCE" here.]
Evidence: [
  "https://www.source-link-1.com/article",
  "https://www.source-link-2.com/news"
]
"""
RAG_PROMPT = PromptTemplate.from_template(RAG_PROMPT_TEMPLATE)

def _extract_section(text: str, label: str) -> str:
    pattern = re.compile(rf"{label}\s*(.*?)(?=\n[A-Z][a-zA-Z]+:|$)", re.IGNORECASE | re.DOTALL)
    match = pattern.search(text)
    return match.group(1).strip() if match else ""

def _normalise_classification(value: str) -> str:
    lowered = (value or "").lower()
    if any(token in lowered for token in ["real", "true", "verified"]):
        return "real"
    if any(token in lowered for token in ["fake", "false", "hoax"]):
        return "fake"
    return "unknown"

def _parse_fact_check_output(raw: str):
    classification = _extract_section(raw, "Classification:")
    reasoning = _extract_section(raw, "Reasoning:")
    evidence_block = _extract_section(raw, "Evidence:")
    evidence = re.findall(r"https?://[^\s\"')]+", evidence_block or "")
    
    # Validate and fix citation numbers in reasoning if they exceed available sources
    if reasoning and evidence:
        max_citation = len(evidence)
        # Find all citation references like [1], [2], [5], etc.
        citation_pattern = re.compile(r'\[(\d+)\]')
        citations_found = citation_pattern.findall(reasoning)
        
        if citations_found:
            max_citation_in_text = max(int(c) for c in citations_found)
            if max_citation_in_text > max_citation:
                print(f"   ⚠️  Warning: Reasoning references citation [{max_citation_in_text}] but only {max_citation} sources available. Citations may be incorrect.")
    
    # Clean up reasoning: remove any evidence/URL sections that might be embedded
    # The LLM sometimes includes the Evidence section in the Reasoning output
    if reasoning:
        # Remove everything from "**Evidence:**" onwards, including the entire array block
        # This pattern matches: **Evidence:** followed by optional whitespace, then [ and everything until the end
        evidence_pattern = re.compile(
            r'\*\*?EVIDENCE\*\*?:?\s*\[.*?\]\s*$',
            re.IGNORECASE | re.DOTALL
        )
        reasoning = evidence_pattern.sub('', reasoning)
        
        # Also handle plain "Evidence:" format
        evidence_pattern2 = re.compile(
            r'EVIDENCE:?\s*\[.*?\]\s*$',
            re.IGNORECASE | re.DOTALL
        )
        reasoning = evidence_pattern2.sub('', reasoning)
        
        # Remove "**Evidence:**" or "Evidence:" markers even without arrays (fallback)
        evidence_pattern3 = re.compile(
            r'\*\*?EVIDENCE\*\*?:?\s*.*$',
            re.IGNORECASE | re.DOTALL
        )
        reasoning = evidence_pattern3.sub('', reasoning)
        
        # Now clean line by line to remove any remaining evidence artifacts
        lines = reasoning.split('\n')
        cleaned_lines = []
        in_evidence_section = False
        bracket_count = 0
        consecutive_stars = 0
        
        for i, line in enumerate(lines):
            # Detect start of evidence section - various formats
            if re.search(r'\*\*?EVIDENCE\*\*?:?', line, re.IGNORECASE):
                in_evidence_section = True
                bracket_count = 0
                continue
            
            if re.search(r'^\s*EVIDENCE:?\s*$', line, re.IGNORECASE):
                in_evidence_section = True
                bracket_count = 0
                continue
            
            # Detect lines with multiple asterisks (like ****) that might indicate evidence section
            star_count = line.count('*')
            if star_count >= 3 and not in_evidence_section:
                # Check if next lines contain URLs - if so, this is likely an evidence marker
                lookahead = '\n'.join(lines[i+1:min(i+5, len(lines))])
                if re.search(r'https?://', lookahead):
                    in_evidence_section = True
                    bracket_count = 0
                    continue
            
            # If we're in an evidence section, track brackets and URLs
            if in_evidence_section:
                # Count brackets to know when array ends
                bracket_count += line.count('[')
                bracket_count -= line.count(']')
                
                # Check if this line contains a URL (quoted or not)
                has_url = bool(re.search(r'https?://', line))
                # Check if this line is just asterisks or whitespace
                is_asterisk_line = re.match(r'^\s*\*+\s*$', line)
                
                # Skip this line if it's part of the evidence array/URLs
                if bracket_count > 0:
                    continue
                elif has_url or is_asterisk_line:
                    # Still in evidence section, skip this line
                    continue
                elif bracket_count == 0 and ']' in line:
                    # Array closed, we're done with evidence section
                    in_evidence_section = False
                    bracket_count = 0
                    continue
                elif not has_url and not is_asterisk_line and bracket_count == 0:
                    # No more URLs or brackets, might be done with evidence section
                    # But check if next line has URL
                    if i + 1 < len(lines):
                        next_line = lines[i + 1]
                        if not re.search(r'https?://', next_line):
                            in_evidence_section = False
                            bracket_count = 0
                    else:
                        in_evidence_section = False
                        bracket_count = 0
                    continue
            
            # Skip standalone URLs (not in evidence section but shouldn't be in reasoning)
            if re.match(r'^\s*https?://', line):
                continue
            if re.match(r'^\s*\d+\.\s*["\']?https?://', line):
                continue
            # Skip array brackets that might be standalone
            if re.match(r'^\s*[\[\]]\s*$', line):
                continue
            # Skip lines with only asterisks
            if re.match(r'^\s*\*+\s*$', line):
                continue
            # Skip quoted URLs that might be standalone
            if re.match(r'^\s*["\']https?://', line):
                continue
            
            cleaned_lines.append(line)
        
        reasoning = '\n'.join(cleaned_lines).strip()
        
        # Final cleanup: remove any remaining evidence markers or trailing brackets
        reasoning = re.sub(r'\*\*?EVIDENCE\*\*?:?\s*', '', reasoning, flags=re.IGNORECASE)
        reasoning = re.sub(r'EVIDENCE:?\s*', '', reasoning, flags=re.IGNORECASE)
        reasoning = re.sub(r'\s*\[\s*\]\s*$', '', reasoning)  # Remove trailing empty arrays
        reasoning = re.sub(r'\s*\[\s*$', '', reasoning)  # Remove trailing opening bracket
        # Remove trailing asterisks
        reasoning = re.sub(r'\s*\*+\s*$', '', reasoning)
        # Remove any trailing quoted URLs
        reasoning = re.sub(r'\s*["\']https?://[^\s"\']+["\']\s*,?\s*$', '', reasoning, flags=re.MULTILINE)
        
        # Remove leading markdown bold markers (**) from the start of the text
        reasoning = re.sub(r'^\s*\*\*\s*', '', reasoning)  # Remove ** at the start
        reasoning = re.sub(r'^\s*\*\s*', '', reasoning)  # Remove single * at the start (fallback)
    
    return _normalise_classification(classification), reasoning or raw.strip(), evidence

def _format_search_results(results) -> str:
    if isinstance(results, str):
        return results[:3000]
    if isinstance(results, list):
        chunks = []
        for idx, item in enumerate(results[:5], start=1):
            if not isinstance(item, dict):
                continue
            title = item.get("title") or "Untitled"
            url = item.get("url") or item.get("link") or ""
            snippet = (
                item.get("content")
                or item.get("snippet")
                or item.get("description")
                or ""
            )[:500]
            chunks.append(f"{idx}. {title}\nURL: {url}\nSummary: {snippet}")
        return "\n\n".join(chunks)
    return str(results)

def run_fact_check(claim: str):
    if not claim.strip():
        return {"error": "Claim must not be empty."}
    print(f"1. Verifying Claim: '{claim}'")
    try:
        search = _ensure_tavily_search()
        print("2. Performing Tavily Search...")
        search_results = _run_tavily_search(search, claim, max_results=5)
        print(f"3. Evidence retrieved. Found {len(search_results) if isinstance(search_results, list) else 'N/A'} results.")
    except Exception as e:
        print(f"Error during Tavily Search: {e}")
        return {"error": str(e)}

    try:
        llm = _ensure_llm()
        # Limit search results to prevent extremely long prompts
        max_results = 5  # Reduced from 10 to speed up processing
        if isinstance(search_results, list) and len(search_results) > max_results:
            search_results = search_results[:max_results]
            print(f"   Limited search results to {max_results} items for faster processing")
        
        final_prompt = RAG_PROMPT.format(
            query=claim,
            search_results=_format_search_results(search_results),
        )
        prompt_length = len(final_prompt)
        print("4. Sending evidence to local LLM for Reasoning...")
        print(f"   Model: {os.getenv('OLLAMA_MODEL', 'llama3.1:8b')}, Prompt length: {prompt_length} chars")
        
        if prompt_length > 10000:
            print(f"   ⚠️  Warning: Large prompt ({prompt_length} chars). This may take 30-60 seconds...")
        elif prompt_length > 5000:
            print(f"   ⚠️  Warning: Medium prompt ({prompt_length} chars). This may take 15-30 seconds...")
        else:
            print(f"   ✓ Prompt size is reasonable. Processing...")
        
        import time
        start_time = time.time()
        response = llm.invoke(final_prompt)
        elapsed = time.time() - start_time
        print(f"5. Received response from LLM in {elapsed:.1f} seconds, parsing...")
        
        raw_text = getattr(response, "content", str(response)).strip()
        if not raw_text:
            print("   ⚠️  Warning: Empty response from LLM")
            return {"error": "Received empty response from the AI model. Please try again."}
        
        print(f"   Response length: {len(raw_text)} chars")
        classification, reasoning, evidence = _parse_fact_check_output(raw_text)
        print(f"6. Classification: {classification}, Evidence URLs: {len(evidence)}")
        return {
            "classification": classification,
            "reasoning": reasoning,
            "evidence": evidence,
            "raw": raw_text,
        }
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Error during LLM Reasoning: {error_msg}")
        print(f"   Error type: {type(e).__name__}")
        
        if "Connection" in error_msg or "timeout" in error_msg.lower() or "refused" in error_msg.lower():
            return {
                "error": f"Failed to connect to Ollama. Make sure Ollama is running and the model '{os.getenv('OLLAMA_MODEL', 'llama3.1:8b')}' is pulled. Error: {error_msg}"
            }
        if "404" in error_msg or "not found" in error_msg.lower():
            model_name = os.getenv('OLLAMA_MODEL', 'llama3.1:8b')
            return {
                "error": f"Model '{model_name}' not found. Please pull it first: 'ollama pull {model_name}'"
            }
        return {"error": f"LLM processing error: {error_msg}"}