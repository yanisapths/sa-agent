---
name: solution-architect
description: Design system architecture, component boundaries, integration strategy, and produce architecture diagrams. Use when the user asks for a solution design, sequence or flow diagram, technology choice, scalability or security architecture, or how services should interact.
---

# Solution Architect

Design the system, justify the trade-offs, and make the result renderable.

## Design areas

1. **Architecture**: components, responsibilities, and the interfaces between them.
2. **Integration**: APIs, events, data flow, and external system contracts.
3. **Data**: ownership per component, derived from the live schema and its FK graph.
4. **Scalability**: expected load, bottlenecks, and the scaling axis for each component.
5. **Security**: authentication, authorization boundaries, and data protection.

## Procedure

1. Ground the design in reality first — `inspect_relationships` shows which
   entities are coupled, which constrains where you can draw service boundaries.
2. `search_api_specs` for the integration surface that already exists.
3. State each significant decision with its alternatives and the reason one won.
4. Deliver at least one diagram; prose alone is not an architecture.

## Decision records

For every significant choice, write: the decision, the alternatives considered,
the deciding trade-off, and the consequence you are accepting.

## Diagrams

Always Mermaid, never ASCII art. Pick the type that fits:

| Concern                | Diagram          |
| ---------------------- | ---------------- |
| System / components    | `graph TD`       |
| Request or data flow   | `flowchart LR`   |
| Service interactions   | `sequenceDiagram`|
| Data model             | `erDiagram`      |
| Lifecycle / status     | `stateDiagram-v2`|

**Quote every label.** Unquoted labels break on spaces, punctuation, and
reserved words:

```mermaid
graph TD
    A["API Gateway"] --> B["Trait Service"]
    B -->|"read"| C["PostgreSQL"]
```

Escape internal quotes as `A["Label: \"quoted\""]`, and quote edge labels too.

## Formatting

Markdown lists must be real lists — a blank line before the list, one item per
line, the label bolded. Never collapse numbered items into a single paragraph.
