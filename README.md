# Quality Assessment of Next.js – Project Archive

This repository contains the final project report and supporting materials for our group project on the quality assessment of the Next.js source repository.

## Contents

### Final Report
- `final_report/Final_Report.pdf`  
  The final written report for the project.

### Supporting Materials
The repository also includes supporting materials related to our project work, such as:

- generated reports
- result files
- mutation testing artifacts
- coverage-related outputs
- benchmarking scripts and results
- configuration files used during analysis
- other repository materials relevant to the final report
- patch or diff files, where applicable

Most results and outputs are also documented in the final report. Please refer to `./final_report/Final_Report.pdf`.

## Project Folders
Some materials are organized by project dimension, including folders such as:

- `dimension 1/` 
- (Dimension 2 white-box testing artifacts)
  - `packages/next/src/lib/create-client-router-filter.test.ts`
  - `packages/next/src/server/image-optimizer.test.ts`
  - `test/c8-coverage/`
  - `test/c8-coverage-current/`
  - `test/c8-coverage-phase-one/`
- `bench/dimension3-benchmark-app/`

## Overview
This project evaluates aspects of software quality in the Next.js codebase through multiple dimensions of analysis. The work includes testing-related evaluation, mutation and coverage-oriented analysis, and benchmarking of selected behaviors.

## Reproducing Selected Results
The following commands were used for selected testing and coverage-related artifacts included in this project.

### Run selected unit tests
```bash
pnpm testonly -- --runTestsByPath test/unit/server/image-optimizer.test.ts test/unit/lib/create-client-router-filter.test.ts
