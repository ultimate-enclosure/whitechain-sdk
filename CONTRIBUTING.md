# Contributing to WhiteChain SDK

Thank you for your interest in contributing to WhiteChain SDK! This document guides you through the contribution process.

## Contribution Workflow

Here's how to contribute:

1. **Browse Issues**: Find available issues tagged for this repository.
2. **Fork and Branch**: Fork the repository and create a feature branch from `main`.
3. **Develop**: Make your changes following the guidelines below.
4. **Test**: Run tests and ensure your changes pass all checks.
5. **Submit PR**: Create a pull request with a description of your changes.
6. **Review**: Maintainers will review your PR. Address feedback promptly.

## Development Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
git clone https://github.com/your-org/whitechain-sdk.git
cd whitechain-sdk
npm install
```

### Building

```bash
npm run build
```

### Testing

```bash
npm run test
```

### Type Checking

```bash
npm run typecheck
```

## Code Style Guidelines

- Use TypeScript for all new code
- Follow existing code patterns in `src/client.ts`
- Keep the public API small and typed
- Use descriptive variable and function names
- Add JSDoc comments for public APIs
- Avoid premature abstraction

## Pull Request Process

1. **Link Issue**: Include the relevant issue number in your PR description.
2. **Summary**: Provide a clear summary of changes.
3. **Test Evidence**: Describe how you tested the changes.
4. **Checklist**: Ensure your PR meets the checklist in the PR template.
5. **Communication**: Respond to review comments within 48 hours.

## Expected PR Quality

- **Scope**: Changes should be focused on the linked issue.
- **Tests**: Include tests for new functionality or bug fixes.
- **Documentation**: Update README and type definitions as needed.
- **Backwards Compatibility**: Avoid breaking changes without justification.
- **Clean History**: Keep commits atomic and well-described.

## Review Process

- Maintainers review PRs.
- Reviews focus on correctness, style, and alignment with project goals.
- Address all review comments before requesting re-review.
- PRs may be rejected if they don't meet quality standards.

## Communication

- Use GitHub issues for bug reports and feature requests.
- Use GitHub discussions for questions and ideas.
- Be respectful and constructive in all communications.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting Help

- Check existing issues and discussions.
- Read the [README](README.md) for usage examples.
- Ask questions in GitHub discussions.

## Campaign-Ready Tasks

Maintainers mark issues as campaign-ready when they:
- Are small and well-scoped
- Have clear acceptance criteria
- Specify expected files to change
- Include estimated difficulty
- Define testing requirements
- Note reviewer expectations

Look for issues tagged with `good first issue` or `help wanted`.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
