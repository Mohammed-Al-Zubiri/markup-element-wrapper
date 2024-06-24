# Change Log

## [1.1.1] - 2024-06-24

### Added
- Language activation events for React (`javascriptreact`) and TypeScript React (`typescriptreact`) files have been fixed to ensure the extension activates correctly in these environments.

### Changed
- The class attribute name is now set dynamically based on the file type. It uses `className` for React files and `class` for all other supported file types. This change improves compatibility and correctness in different development contexts.

## [1.1.0] - 2024-06-12

- Added support for handling multiple selections

## [1.0.0] - 2024-06-8

- Initial release