import sys

with open('backend/agents/personas.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Ensure we're deleting the right lines by checking some content
assert 'async def design_custom_personas(' in lines[335]
assert 'async def design_custom_personas(' in lines[530]

del lines[335:530]

# Add _CUSTOM_COLORS
for i, line in enumerate(lines):
    if line.startswith('CUSTOM_PALETTE = ['):
        idx = i
        while not lines[idx].strip() == ']':
            idx += 1
        lines.insert(idx + 1, '_CUSTOM_COLORS = itertools.cycle(CUSTOM_PALETTE)\n')
        break

# Add import itertools
for i, line in enumerate(lines):
    if line.startswith('import asyncio'):
        lines.insert(i + 1, 'import itertools\n')
        break

with open('backend/agents/personas.py', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Fixed personas.py")
