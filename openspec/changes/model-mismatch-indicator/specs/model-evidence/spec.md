## ADDED Requirements

### Requirement: Requested-vs-reported mismatch indicator
The sidebar SHALL mark the **Model evidence** line when the requested and reported model identifiers differ after normalizing (trim, lowercase, strip one leading `provider/` segment), and SHALL NOT mark it when they match or when either identifier is missing.

#### Scenario: Divergent reported model is flagged
- **GIVEN** a session whose requested model is `gpt-6-astra` and reported model is `gpt-6-astra-x`
- **WHEN** the sidebar renders the evidence line
- **THEN** the line shows a ` · mismatch` suffix in the warning color

#### Scenario: Case and provider prefix are not divergence
- **GIVEN** a requested model `deepseek-v4.1-flash` and a reported model `deepseek/deepseek-v4.1-flash` or `DeepSeek-V4.1-Flash`
- **WHEN** the sidebar renders the evidence line
- **THEN** no mismatch is shown

#### Scenario: Echoed model is not a mismatch
- **GIVEN** a relay that returns the requested id as the reported model
- **WHEN** the sidebar renders the evidence line
- **THEN** no mismatch is shown, because an echoed id is not proof of the backend model

#### Scenario: Missing evidence is unknown
- **GIVEN** a session with no reported model
- **WHEN** the sidebar renders the evidence line
- **THEN** no mismatch is shown and the line still reads `unknown` / `not captured`
