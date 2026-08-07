import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from agents.orchestrator import evaluate_idea

async def main():
    print("Testing evaluate_idea...")
    try:
        result = await asyncio.wait_for(
            evaluate_idea("A subscription service for college students", context="", max_agents=1),
            timeout=30.0
        )
        print("Success! Result:")
        print(result.keys())
    except asyncio.TimeoutError:
        print("Error: The call timed out!")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
