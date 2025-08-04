function renderExampleFromSchema(schema, openapi) {
    if (!schema) return null;

    if (schema.$ref) {
        schema = resolveRef(schema.$ref, openapi);
    }

    if (schema.example !== undefined) return schema.example;

    if (schema.type === 'object' && schema.properties) {
        const example = {};
        for (const [key, prop] of Object.entries(schema.properties)) {
            const resolved = prop.$ref ? resolveRef(prop.$ref, openapi) : prop;

            if (resolved.example !== undefined) {
                example[key] = resolved.example;
            } else {
                example[key] = renderExampleFromSchema(resolved, openapi);
            }
        }
        return example;
    }

    if (schema.type === 'array' && schema.items) {
        const itemSchema = schema.items.$ref
            ? resolveRef(schema.items.$ref, openapi)
            : schema.items;
        return [renderExampleFromSchema(itemSchema, openapi)];
    }

    return generateDefaultExample(schema);
}


function generateDefaultExample(schema) {
    if (!schema) return null;
    const type = schema.type;
    if (schema.enum) return schema.enum[0];
    switch (type) {
        case 'string':
            return 'string';
        case 'integer':
            return 0;
        case 'number':
            return 0.0;
        case 'boolean':
            return true;
        case 'array':
            return [];
        case 'object':
            return {};
        default:
            return null;
    }
}

function renderExampleFromMediaTypeContent(content, openapi) {
    const mediaType = Object.keys(content)[0];
    const media = content[mediaType];

    if (!media) return null;

    // #1 top-level example
    if (media.example) {
        return media.example;
    }

    // #2 examples field
    if (media.examples) {
        const firstExample = Object.values(media.examples)[0];
        if (firstExample && firstExample.value) {
            return firstExample.value;
        }
    }

    // #3 schema
    const schema = media.schema;
    if (!schema) return null;

    return renderExampleFromSchema(schema, openapi);
}

/**
 * OpenAPI JSON → Markdown 변환
 * @param {object} openapi - OpenAPI JSON 객체
 * @returns {string} - Markdown 문서
 */
function resolveRef(ref, openapi) {
    const refPath = ref.replace(/^#\//, '').split('/');
    return refPath.reduce((obj, key) => obj && obj[key], openapi);
}

function renderSchemaFields(schema, openapi, parentKey = '') {
    if (schema.$ref) schema = resolveRef(schema.$ref, openapi);
    let rows = [];

    if (schema.type === 'object' && schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
            const resolved = prop.$ref ? resolveRef(prop.$ref, openapi) : prop;
            const type = resolved.type || 'object';
            const nullable = resolved.nullable === true ? 'true' : 'false';
            const example = resolved.example !== undefined ? JSON.stringify(resolved.example) : '';
            const description = resolved.description || '';

            const fullKey = parentKey ? `${parentKey}.${key}` : key;
            rows.push(`| ${fullKey} | ${type} | ${nullable} | ${example} | ${description} |`);

            // ✅ 재귀적으로 중첩된 필드도 동일 테이블 안에 한 줄씩 추가
            if (type === 'object' && resolved.properties) {
                rows.push(...renderSchemaFields(resolved, openapi, fullKey));
            }

            if (type === 'array' && resolved.items) {
                const itemSchema = resolved.items.$ref
                    ? resolveRef(resolved.items.$ref, openapi)
                    : resolved.items;
                const arrayKey = `${fullKey}[]`;
                const itemType = itemSchema.type || 'object';
                const itemNullable = itemSchema.nullable === true ? 'true' : 'false';
                const itemExample = itemSchema.example !== undefined ? JSON.stringify(itemSchema.example) : '';
                const itemDesc = itemSchema.description || '';

                rows.push(`| ${arrayKey} | ${itemType} | ${itemNullable} | ${itemExample} | ${itemDesc} |`);

                if (itemType === 'object' || itemSchema.properties || itemSchema.$ref) {
                    rows.push(...renderSchemaFields(itemSchema, openapi, arrayKey));
                }
            }
        }
    }

    return rows;
}

/**
 *
 * @param openapi
 * @returns {string} openapi markdown
 */
function convertToMarkdown(openapi) {
    let md = `# ${openapi.info.title}\n\n**Version:** ${openapi.info.version}\n\n`;

    for (const pathKey in openapi.paths) {
        const methods = openapi.paths[pathKey];
        for (const method in methods) {
            const api = methods[method];
            md += `---\n\n`;
            md += `## ${api.summary || pathKey}\n\n`;
            md += `**Method:** \`${method.toUpperCase()}\`\n\n`;
            md += `**Path:** \`${pathKey}\`\n\n`;

            if (api.description) {
                md += `**Description:**\n${api.description}\n\n`;
            }

            // Parameters
            if (api.parameters && api.parameters.length > 0) {
                md += `**Parameters:**\n\n`;
                md += `| Name | In | Type | Required | Description (Example) |\n`;
                md += `|------|----|------|----------|------------------------|\n`;
                for (const param of api.parameters) {
                    const schema = param.schema || {};
                    const type = schema.type || '-';
                    const example = param.example || schema.example || '';
                    const desc = (param.description || '') + (example ? ` _(e.g. ${example})_` : '');
                    md += `| ${param.name} | ${param.in} | ${type} | ${param.required || false} | ${desc} |\n`;
                }
                md += `\n`;
            }

            // Request Body
            if (api.requestBody) {
                const content = api.requestBody.content || {};
                const example = renderExampleFromMediaTypeContent(content, openapi);
                const mediaType = Object.keys(content)[0];
                const schema = content[mediaType]?.schema;

                if (example) {
                    md += `**Request Body:** \`${mediaType}\`\n\n`;
                    md += '```json\n' + JSON.stringify(example, null, 2) + '\n```\n\n';
                }

                if (schema) {
                    md += `**Request Fields:**\n\n`;
                    const rows = renderSchemaFields(schema, openapi);
                    md += `| Field | Type | Nullable | Example | Description |\n`;
                    md += `|-------|------|----------|---------|-------------|\n`;
                    md += rows.join('\n') + '\n';
                }
            }

            // Responses
            if (api.responses) {
                md += `**Responses:**\n\n`;
                for (const status in api.responses) {
                    const res = api.responses[status];
                    md += `### \`${status}\`: ${res.description || ''}\n\n`;

                    const content = res.content || {};
                    const example = renderExampleFromMediaTypeContent(content, openapi);
                    const mediaType = Object.keys(content)[0];
                    const schema = content[mediaType]?.schema;

                    if (example) {
                        md += `**Media Type:** \`${mediaType}\`\n\n`;
                        md += '```json\n' + JSON.stringify(example, null, 2) + '\n```\n\n';
                    }

                    if (schema) {
                        md += `**Response Fields:**\n\n`;
                        const rows = renderSchemaFields(schema, openapi);
                        md += `| Field | Type | Nullable | Example | Description |\n`;
                        md += `|-------|------|----------|---------|-------------|\n`;
                        md += rows.join('\n') + '\n';
                    }
                }
            }

            md += `\n`;
        }
    }

    return md;
}