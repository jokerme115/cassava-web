/**
 * eslint-plugin-i18n-check.js
 * Custom ESLint rule to enforce i18n usage in UI messages.
 */

export default {
  rules: {
    "no-hardcoded-messages": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Disallow hardcoded Chinese strings in message/notification/Modal calls",
          category: "Best Practices",
          recommended: true,
        },
        schema: [],
      },
      create: function (context) {
        return {
          CallExpression(node) {
            // Check for message.success('中文'), notification.info({ message: '中文' }), etc.
            const callee = node.callee;
            
            // Check for Ant Design 'message' and 'Modal' static methods
            if (
              callee.type === 'MemberExpression' &&
              callee.object.type === 'Identifier' &&
              ['message', 'Modal', 'notification'].includes(callee.object.name)
            ) {
              // message.success('text')
              if (['success', 'error', 'warning', 'info', 'loading', 'confirm'].includes(callee.property.name)) {
                const arg0 = node.arguments[0];
                if (arg0 && arg0.type === 'Literal' && typeof arg0.value === 'string') {
                  if (/[\u4e00-\u9fa5]/.test(arg0.value)) {
                    context.report({
                      node: arg0,
                      message: "Hardcoded Chinese string found in UI message. Please use i18n key.",
                    });
                  }
                }
                
                // Modal.confirm({ title: '中文' })
                if (arg0 && arg0.type === 'ObjectExpression') {
                   arg0.properties.forEach(prop => {
                     if (['title', 'content'].includes(prop.key.name) && prop.value.type === 'Literal') {
                        if (/[\u4e00-\u9fa5]/.test(prop.value.value)) {
                          context.report({
                            node: prop.value,
                            message: "Hardcoded Chinese string found in Modal config. Please use i18n key.",
                          });
                        }
                     }
                   });
                }
              }
            }
          },
        };
      },
    },
  },
};
