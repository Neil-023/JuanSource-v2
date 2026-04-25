import pytest
from unittest.mock import patch
from app.fact_checker import run_fact_check
from app.fact_checkerOLLAMA import run_fact_check as run_fact_check_ollama

def test_tavily_search_exception_handling():
    with patch("app.fact_checker._ensure_tavily_search", side_effect=Exception("Database connection timeout")):
        result = run_fact_check("Apples are orange.")
        assert result == {"error": "Internal Service Error"}

def test_gemini_reasoning_exception_handling():
    with patch("app.fact_checker._ensure_tavily_search"):
        with patch("app.fact_checker._run_tavily_search", return_value=[]):
            with patch("app.fact_checker._ensure_llm", side_effect=Exception("Invalid API Key")):
                result = run_fact_check("Apples are orange.")
                assert result == {"error": "Internal Service Error"}

def test_ollama_tavily_search_exception_handling():
    with patch("app.fact_checkerOLLAMA._ensure_tavily_search", side_effect=Exception("Timeout")):
        result = run_fact_check_ollama("Apples are orange.")
        assert result == {"error": "Internal Service Error"}

def test_ollama_reasoning_exception_handling():
    with patch("app.fact_checkerOLLAMA._ensure_tavily_search"):
        with patch("app.fact_checkerOLLAMA._run_tavily_search", return_value=[]):
            with patch("app.fact_checkerOLLAMA._ensure_llm", side_effect=Exception("Connection refused")):
                result = run_fact_check_ollama("Apples are orange.")
                assert result == {"error": "Internal Service Error"}
