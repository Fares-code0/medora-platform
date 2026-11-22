import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Field = {
  name: string;
  type: string;
  isList: boolean;
  isOptional: boolean;
  relationName: string | undefined;
  raw: string;
};

type Model = {
  name: string;
  fields: Field[];
  body: string;
};

const schemaDirectory = resolve('prisma/schema');
const outputPath = resolve('docs/DATABASE_ERD.md');
const modelBlocks = new Map<string, Model>();

for (const fileName of readdirSync(schemaDirectory)
  .filter((name) => name.endsWith('.prisma'))
  .sort()) {
  const source = readFileSync(join(schemaDirectory, fileName), 'utf8');
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const match of source.matchAll(modelPattern)) {
    const name = match[1];
    const body = match[2];
    if (name === undefined || body === undefined) continue;
    const fields: Field[] = [];
    for (const line of body.split(/\r?\n/)) {
      const declaration = line.match(/^\s{2,}(\w+)\s+([A-Za-z_]\w*)(\[\])?(\?)?\s*(.*)$/);
      if (declaration === null) continue;
      const [, fieldName, fieldType, listMarker, optionalMarker, raw] = declaration;
      if (fieldName === undefined || fieldType === undefined) continue;
      fields.push({
        name: fieldName,
        type: fieldType,
        isList: listMarker === '[]',
        isOptional: optionalMarker === '?',
        relationName: raw?.match(/@relation\(\s*"([^"]+)"/)?.[1],
        raw: raw ?? '',
      });
    }
    modelBlocks.set(name, { name, fields, body });
  }
}

const primaryKeys = new Map<string, Set<string>>();
const uniqueKeys = new Map<string, Set<string>>();
const uniqueSets = new Map<string, string[][]>();
const foreignKeys = new Map<string, Set<string>>();
const relationships = new Map<
  string,
  {
    from: string;
    to: string;
    field: string;
    isList: boolean;
    isOptional: boolean;
    isUnique: boolean;
  }
>();

for (const model of modelBlocks.values()) {
  const primary = new Set<string>();
  const unique = new Set<string>();
  const uniqueSetList: string[][] = [];
  const foreign = new Set<string>();
  for (const field of model.fields) {
    if (field.raw.includes('@id')) {
      primary.add(field.name);
      uniqueSetList.push([field.name]);
    }
    if (field.raw.includes('@unique')) {
      unique.add(field.name);
      uniqueSetList.push([field.name]);
    }
    if (field.raw.includes('@relation')) {
      const relationFields = field.raw.match(/fields:\s*\[([^\]]+)\]/)?.[1];
      const relationName = field.raw.match(/@relation\(\s*"([^"]+)"/)?.[1];
      const refs =
        relationFields
          ?.split(',')
          .map((part) => part.trim())
          .filter(Boolean) ?? [];
      refs.forEach((ref) => foreign.add(ref));
      if (refs.length > 0) {
        const key = relationName ?? [model.name, field.type].sort().join('__');
        const target = field.type;
        const uniqueForeignKey = refs.length === 1 && unique.has(refs[0] ?? '');
        relationships.set(key, {
          from: model.name,
          to: target,
          field: field.name,
          isList: field.isList,
          isOptional: field.isOptional,
          isUnique: uniqueForeignKey,
        });
      }
    }
  }
  for (const compoundPrimary of model.body.matchAll(/@@id\(\[([^\]]+)\]/g)) {
    const fields =
      compoundPrimary[1]
        ?.split(',')
        .map((part) => part.trim())
        .filter(Boolean) ?? [];
    fields.forEach((field) => primary.add(field));
    uniqueSetList.push(fields);
  }
  for (const compoundUnique of model.body.matchAll(/@@unique\(\[([^\]]+)\]([^\n]*)/g)) {
    if (/\bwhere\s*:/.test(compoundUnique[2] ?? '')) continue;
    const fields =
      compoundUnique[1]
        ?.split(',')
        .map((part) => part.trim())
        .filter(Boolean) ?? [];
    uniqueSetList.push(fields);
  }
  primaryKeys.set(model.name, primary);
  uniqueKeys.set(model.name, unique);
  uniqueSets.set(model.name, uniqueSetList);
  foreignKeys.set(model.name, foreign);
}

// Recompute whether each relation FK is unique after compound unique keys were collected.
for (const [key, relation] of relationships) {
  const owner = modelBlocks.get(relation.from);
  const relationField = owner?.fields.find((field) => field.name === relation.field);
  const refsText = relationField?.raw.match(/fields:\s*\[([^\]]+)\]/)?.[1];
  const refs =
    refsText
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean) ?? [];
  const ownerUniqueSets = uniqueSets.get(relation.from) ?? [];
  const relationUnique = ownerUniqueSets.some(
    (fields) => fields.length === refs.length && refs.every((field) => fields.includes(field)),
  );
  relationships.set(key, {
    ...relation,
    isUnique: relation.isUnique || relationUnique,
  });
}

const diagram: string[] = ['erDiagram'];
for (const model of [...modelBlocks.values()].sort((left, right) =>
  left.name.localeCompare(right.name),
)) {
  diagram.push(`  ${model.name} {`);
  for (const field of model.fields.filter((item) => !modelBlocks.has(item.type))) {
    const keys = [
      (primaryKeys.get(model.name) ?? new Set()).has(field.name) ? 'PK' : '',
      (foreignKeys.get(model.name) ?? new Set()).has(field.name) ? 'FK' : '',
      (uniqueKeys.get(model.name) ?? new Set()).has(field.name) ? 'UK' : '',
    ].filter(Boolean);
    const fieldType = field.isList ? `${field.type}_array` : field.type;
    diagram.push(`    ${fieldType} ${field.name}${keys.length ? ` ${keys.join(',')}` : ''}`);
  }
  diagram.push('  }');
  for (const constraint of model.body.matchAll(/@@unique\(\[([^\]]+)\]([^\n]*)/g)) {
    diagram.push(
      `  %% Prisma constraint: ${model.name} @@unique([${constraint[1]}]${constraint[2]}`,
    );
  }
  for (const index of model.body.matchAll(/@@index\(\[([^\]]+)\]([^\n]*)/g)) {
    diagram.push(`  %% Prisma index: ${model.name} @@index([${index[1]}]${index[2]}`);
  }
}

for (const relation of [...relationships.values()].sort((left, right) => {
  return `${left.from}.${left.field}`.localeCompare(`${right.from}.${right.field}`);
})) {
  if (!modelBlocks.has(relation.to)) continue;
  const child = modelBlocks.get(relation.from);
  const parent = modelBlocks.get(relation.to);
  const ownerField = child?.fields.find((field) => field.name === relation.field);
  const otherRelation = parent?.fields.find(
    (field) =>
      field.type === relation.from &&
      field.raw.includes('@relation') &&
      (ownerField?.relationName === undefined || field.relationName === ownerField.relationName),
  );
  const isMany = otherRelation?.isList ?? relation.isList;
  const label = relation.field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  if (isMany) {
    const childCardinality = 'o{';
    const parentCardinality = relation.isOptional ? 'o|' : '||';
    diagram.push(
      `  ${relation.to} ${parentCardinality}--${childCardinality} ${relation.from} : "${label}"`,
    );
  } else {
    const childCardinality = relation.isOptional ? 'o|' : '||';
    const parentCardinality = relation.isUnique ? 'o|' : 'o{';
    diagram.push(
      `  ${relation.to} ${childCardinality}--${parentCardinality} ${relation.from} : "${label}"`,
    );
  }
  void ownerField;
}

const content = [
  '# Medora Database ERD',
  '',
  'This diagram is generated from the authoritative split Prisma schema in `backend/prisma/schema/`.',
  'It includes every Prisma model and relation. Column types and PK/FK/unique markers come from the schema;',
  'partial indexes, check constraints, triggers and referential actions remain defined in the Prisma files and',
  'SQL migrations. The diagram describes structural ownership only; it does not imply runtime authorization.',
  '',
  'Regenerate after schema changes from `backend/` with `npm run db:erd` (after Prisma Client generation).',
  '',
  '```mermaid',
  ...diagram,
  '```',
  '',
].join('\n');

writeFileSync(outputPath, content, 'utf8');
console.info(
  `Wrote ${modelBlocks.size} Prisma models and ${relationships.size} FK relations to ${outputPath}`,
);
