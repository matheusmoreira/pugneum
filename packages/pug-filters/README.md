# pug-filters

Code for processing filters in pug templates

[![Build Status](https://img.shields.io/travis/pugjs/pug-filters/master.svg)](https://travis-ci.org/pugjs/pug-filters)
[![Dependencies Status](https://david-dm.org/pugjs/pug/status.svg?path=packages/pug-filters)](https://david-dm.org/pugjs/pug?path=packages/pug-filters)
[![DevDependencies Status](https://david-dm.org/pugjs/pug/dev-status.svg?path=packages/pug-filters)](https://david-dm.org/pugjs/pug?path=packages/pug-filters&type=dev)
[![NPM version](https://img.shields.io/npm/v/pug-filters.svg)](https://www.npmjs.org/package/pug-filters)

## Installation

    npm install pug-filters

## Usage

```
var filters = require('pug-filters');
```

### `filters.handleFilters(ast, filters)`

Renders all `Filter` nodes in a Pug AST (`ast`), using user-specified filters (`filters`) or a JSTransformer.

## License

  MIT
