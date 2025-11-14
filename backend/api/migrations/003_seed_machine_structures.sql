-- Seed sample machine structures for two companies using INSERT ... SELECT
-- This assumes sample companies from [001_create_companies_table.sql](backend/api/migrations/001_create_companies_table.sql)
-- Acme Corporation: line -> machine
INSERT INTO machine_structures (company_id, structure_json, version)
SELECT
  c.id,
  '{
    "nodeTypes": [
      { "key": "line", "label": "Line", "attributes": [ { "key": "name", "type": "string", "required": true } ] },
      { "key": "machine", "label": "Machine", "attributes": [ { "key": "name", "type": "string", "required": true } ] }
    ],
    "rules": [
      { "parent": "line", "child": "machine" }
    ],
    "tree": {
      "id": "root",
      "type": "root",
      "children": [
        {
          "id": "line_L1",
          "type": "line",
          "attrs": { "name": "Line 1" },
          "children": [
            { "id": "machine_L1_M1", "type": "machine", "attrs": { "name": "Machine 1" }, "children": [] },
            { "id": "machine_L1_M2", "type": "machine", "attrs": { "name": "Machine 2" }, "children": [] }
          ]
        },
        {
          "id": "line_L2",
          "type": "line",
          "attrs": { "name": "Line 2" },
          "children": [
            { "id": "machine_L2_M1", "type": "machine", "attrs": { "name": "Machine 1" }, "children": [] }
          ]
        }
      ]
    }
  }',
  1
FROM companies c
WHERE c.name = 'Acme Corporation'
ON DUPLICATE KEY UPDATE
  structure_json = VALUES(structure_json),
  version = version + 1,
  updated_at = CURRENT_TIMESTAMP;

-- Globex Inc: machine -> subline -> project
INSERT INTO machine_structures (company_id, structure_json, version)
SELECT
  c.id,
  '{
    "nodeTypes": [
      { "key": "machine", "label": "Machine", "attributes": [ { "key": "name", "type": "string", "required": true } ] },
      { "key": "subline", "label": "Subline", "attributes": [ { "key": "name", "type": "string", "required": true } ] },
      { "key": "project", "label": "Project", "attributes": [ { "key": "name", "type": "string", "required": true } ] }
    ],
    "rules": [
      { "parent": "machine", "child": "subline" },
      { "parent": "subline", "child": "project" }
    ],
    "tree": {
      "id": "root",
      "type": "root",
      "children": [
        {
          "id": "machine_MA",
          "type": "machine",
          "attrs": { "name": "Machine A" },
          "children": [
            {
              "id": "subline_A1",
              "type": "subline",
              "attrs": { "name": "Subline A1" },
              "children": [
                { "id": "project_A1_P1", "type": "project", "attrs": { "name": "Project P1" }, "children": [] }
              ]
            }
          ]
        },
        {
          "id": "machine_MB",
          "type": "machine",
          "attrs": { "name": "Machine B" },
          "children": [
            {
              "id": "subline_B1",
              "type": "subline",
              "attrs": { "name": "Subline B1" },
              "children": [
                { "id": "project_B1_P1", "type": "project", "attrs": { "name": "Project P1" }, "children": [] },
                { "id": "project_B1_P2", "type": "project", "attrs": { "name": "Project P2" }, "children": [] }
              ]
            }
          ]
        }
      ]
    }
  }',
  1
FROM companies c
WHERE c.name = 'Globex Inc'
ON DUPLICATE KEY UPDATE
  structure_json = VALUES(structure_json),
  version = version + 1,
  updated_at = CURRENT_TIMESTAMP;