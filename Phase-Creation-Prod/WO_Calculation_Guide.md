# Phase Creation Calculation Guide

## Overview
This document provides an end-to-end understanding of all calculations used in the backend system (index.js), including how TDL, COO, DE, Proto, Serie, and percentages are utilized, and how these affect custom fields and KPIs.

---

## Table of Contents
1. [Core Metrics (TDL, COO, DE)](#core-metrics)
2. [Phase Multipliers (Proto, Serie)](#phase-multipliers)
3. [Calculation Functions](#calculation-functions)
4. [Custom Fields Updated](#custom-fields-updated)
5. [KPI Calculations](#kpi-calculations)
6. [Data Flow & Propagation](#data-flow--propagation)

---

## Core Metrics

### TDL (Technical Design Lead)
- **Purpose**: Represents design effort hours for technical design activities
- **Type**: Numeric value (hours)
- **Updated By**: 
  - `processJsonWithPhase()` - Multiplies by phase factor
  - `update2DDrawingData()` - Adjusted for 2D drawings
  - `updateDataManagement()` - Adjusted for data management
  - `updateIndustrializationValues()` - Adjusted for industrialization

### COO (Coordination/Oversee)
- **Purpose**: Represents coordination/oversight effort hours
- **Type**: Numeric value (hours)
- **Updated By**: Same functions as TDL

### DE (Design Engineer)
- **Purpose**: Represents design engineer effort hours
- **Type**: Numeric value (hours)
- **Updated By**: Same functions as TDL

**Relationship**: These three metrics are summed together to calculate total hours:
```javascript
const total = TDL + COO + DE
const standard = TDL + COO + DE  // Standard hours
```

---

## Phase Multipliers

### Proto vs Serie
**Purpose**: Different production phases require different effort multiplications

**How They Work**:
- **Proto Phase**: Product prototype/testing phase
- **Serie Phase**: Serial production phase

**Implementation** (`processJsonWithPhase()` function):
```javascript
const multiplier = phaseValue[phase] || 0;
// For example, if phase = "Proto" and phaseValue.Proto = 2
// Then: TDL *= 2, COO *= 2, DE *= 2
```

**Data Structure**:
```javascript
// Each subactivity has phase multipliers:
{
  subactivity: {
    "Activity Name": {
      "Proto": 1,      // 1x effort for Proto phase
      "Serie": 0.8,    // 0.8x effort for Serie phase
      "TDL": 10,       // Base TDL hours
      "COO": 5,        // Base COO hours
      "DE": 15,        // Base DE hours
      "order": 1
    }
  }
}
```

**Key Logic** (Lines ~1544-1587):
```javascript
function processJsonWithPhase(data, phase) {
  Object.keys(data).forEach((activityKey) => {
    let activityData = data[activityKey];
    Object.keys(activityData).forEach((roof) => {
      if (typeof roofData === "object" && "TDL" in roofData) {
        let multiplier = roofData[phase] || 0;  // Get phase multiplier
        roofData["TDL"] *= multiplier;
        roofData["COO"] *= multiplier;
        roofData["DE"] *= multiplier;
      }
    });
  });
  return data;
}
```

---

## Calculation Functions

### 1. calculateSumsWithTotal()
**Purpose**: Aggregates TDL, COO, DE values across selected parts

**Location**: Lines ~432-464

**Logic**:
```javascript
function calculateSumsWithTotal(data, keysToConsider) {
  Object.keys(data).forEach((section) => {
    let totals = { TDL: 0, DE: 0, COO: 0 };
    
    keysToConsider.forEach((key) => {
      const part = data[section][key];
      totals.TDL += part.TDL || 0;
      totals.DE += part.DE || 0;
      totals.COO += part.COO || 0;
    });
    
    const standard = totals.TDL + totals.DE + totals.COO;
    
    // Update the section with aggregated values
    data[section].TDL = totals.TDL;
    data[section].DE = totals.DE;
    data[section].COO = totals.COO;
    data[section].total = 0;
    data[section].standard = standard;
  });
  return data;
}
```

**Output**:
- `section.TDL` - Sum of all TDL values
- `section.DE` - Sum of all DE values
- `section.COO` - Sum of all COO values
- `section.standard` - Sum of TDL + DE + COO

---

### 2. processJsonWithPhase()
**Purpose**: Applies phase multipliers to metrics

**Location**: Lines ~1544-1587

**Parameters**:
- `data`: Activity data structure
- `phase`: "Proto" or "Serie"

**Logic**:
```javascript
// For each activity and subactivity:
let multiplier = roofData[phase] || 0;  // Get multiplier for phase
roofData["TDL"] *= multiplier;
roofData["COO"] *= multiplier;
roofData["DE"] *= multiplier;
```

**Example**:
```
If Proto = 2 and base TDL = 10:
Calculated TDL = 10 * 2 = 20 hours
```

---

### 3. update2DDrawingData()
**Purpose**: Adjusts TDL, COO, DE for 2D Drawing activities using percentages

**Location**: Lines ~1589-1638

**Formula**:
```javascript
TDL = (phase_multiplier * value * percentage_TDL * (percentage_phase / 100)) / 100
COO = (phase_multiplier * value * percentage_COO * (percentage_phase / 100)) / 100
DE = (phase_multiplier * value * percentage_DE * (percentage_phase / 100)) / 100
```

**Parameters**:
- `phase_multiplier`: Proto/Serie multiplier (e.g., 1 for standard)
- `value`: Drawing data value
- `percentage_TDL`, `percentage_COO`, `percentage_DE`: Percentage allocations
- `percentage_phase`: Phase percentage adjustment

**Example**:
```
If phase_multiplier=1, value=100, percentage_TDL=30, percentage_phase=100:
TDL = (1 * 100 * 30 * (100/100)) / 100 = 30 hours
```

---

### 4. updateDataManagement()
**Purpose**: Adjusts metrics for Data Management activities

**Location**: Lines ~1640-1687

**Logic**: Same formula as 2D Drawing
```javascript
TDL = (phase_multiplier * value * percentage_TDL * (percentage_phase / 100)) / 100
```

**Triggers**: When activity includes:
- "Customer input data management"
- "Data management"
- "Upload & Download customer data"

---

### 5. updateIndustrializationValues()
**Purpose**: Updates industrialization activities based on Proto and Serie data

**Location**: Lines ~1689-1718

**Logic**:
```javascript
// Sum values from both phases
let summedValue = proto_value + serie_value;

// Apply percentage increment
let increment = (percentage / 100) * summedValue;

// Update industrialization metrics
detailedJson[key].standard = increment;
detailedJson[key].DE = increment;
```

**Percentages Applied**:
- `_3DModification`: 15%
- `_2DModification`: 15%
- `dataManagement`: 15%

---

## Custom Fields Updated

### Standard Hours Fields

| Custom Field ID | Field Name | Purpose | Updated By |
|---|---|---|---|
| **customfield_10061** | Standard Hours | Total standard (TDL + COO + DE) | calculateAndUpdateField(), processLoops() |
| **customfield_10075** | COO Planned | COO planned hours | processLoops() |
| **customfield_10076** | DE Planned | DE planned hours | processLoops() |
| **customfield_10077** | TDL Planned | TDL planned hours | processLoops() |

### Actual Hours Fields

| Custom Field ID | Field Name | Purpose | Data Source |
|---|---|---|---|
| **customfield_10081** | DE Actual Hours | Actual DE hours logged | Worklog → updateLog() |
| **customfield_10082** | COO Act Hours | Actual COO hours logged | Worklog → updateLog() |
| **customfield_10083** | TDL Act Hrs | Actual TDL hours logged | Worklog → updateLog() |
| **customfield_10065** | Actual Hours | Sum of all actual hours | DE + COO + TDL actual |

### Variation Fields

| Custom Field ID | Field Name | Purpose | Calculation |
|---|---|---|---|
| **customfield_10084** | Extra Work | Extra work hours | For "Extra Work" issues |
| **customfield_10085** | Rework | Rework hours | For "Re-Work" issues |
| **customfield_10086** | Rework Ratio | Rework percentage | (Rework / Actual Hours) * 100 |
| **customfield_10070** | EWR | Extra Work Ratio | (Extra Work / Actual Hours) * 100 |

### Estimation Fields

| Custom Field ID | Field Name | Purpose |
|---|---|---|
| **customfield_10056** | Task Estimation | Estimated hours for task |

### Date Fields

| Custom Field ID | Field Name | Purpose |
|---|---|---|
| **customfield_10015** | Start Date | Activity start date |
| **customfield_10053** | End Date | Planned end date |
| **customfield_10009** | Actual End | Actual completion date |

---

## KPI Calculations

### 1. Actual Total Hours (customfield_10065)
**Formula**:
```javascript
Actual Hours = customfield_10083 + customfield_10082 + customfield_10081
             = TDL Actual + COO Actual + DE Actual
```

**Location**: Lines ~2286-2287

**Scope**: Updated for all issue types
- Activity
- Work Order
- Task
- Activity Group

---

### 2. DFS - Design Schedule Variance (customfield_10066)
**Purpose**: Measures schedule adherence

**Formula**:
```javascript
DFS = ((Actual Closing Hours - Standard Hours) / Standard Hours) * 100
    = ((customfield_10093 - customfield_10971) / customfield_10971) * 100
```

**Where**:
- `customfield_10093`: Actual closing hours (DFS Act Hrs)
- `customfield_10971`: Standard hours at closing
- `customfield_10061`: Planned standard hours

**Conditions**:
- **For Activity**: Only calculated when status = "Closed"
- **For Activity Group/Project/Phase**: 
  - If both values are 0 or null → DFS = null
  - If actual equals standard → DFS = 0
  - Otherwise → Calculate percentage

**Location**: Lines ~2323-2372

---

### 3. EWR - Extra Work Ratio (customfield_10070)
**Purpose**: Tracks extra work percentage

**Formula**:
```javascript
EWR = (Extra Work Hours / Actual Hours) * 100
    = (customfield_10084 / customfield_10065) * 100
```

**Scope**: Calculated for:
- Project
- Phase
- Activity Group

**Location**: Lines ~2383-2389

---

### 4. Rework Ratio (customfield_10086)
**Purpose**: Tracks rework percentage

**Formula**:
```javascript
Rework = (Rework Hours / Actual Hours) * 100
       = (customfield_10085 / customfield_10065) * 100
```

**Scope**: Same as EWR

---

### 5. DED - Design Engineer Deviation (customfield_10068)
**Purpose**: Measures DE hour variation

**Formula**:
```javascript
DED = ((Actual DE - Estimated DE) / Estimated DE) * 100
    = ((customfield_10972 - customfield_10092) / customfield_10092) * 100
```

**Where**:
- `customfield_10972`: Actual DE hours (updated when Task is Closed)
- `customfield_10092`: Task Estimation

**Location**: Lines ~2412-2417

---

### 6. WO-FTR - Work Order First Time Right (customfield_10100/10101)
**Purpose**: Quality metric - measures first time completion without rejection

**Calculation** (Lines ~2505-2549):
1. Find all Work Orders under an issue
2. Fetch WO-FTR values for each WO
3. Calculate average: `average = sum / count`
4. Update parent with:
   - `customfield_10100`: Average ratio (e.g., 0.95)
   - `customfield_10101`: Average percentage (e.g., 95.0)

**Formula**:
```javascript
WO-FTR Percentage = (Average WO-FTR * 100)
```

---

### 7. OTD - On Time Delivery (customfield_10094/10095/10096)
**Purpose**: Measures schedule performance

**Functions**: `dateDifference()` - Lines ~2203-2240

**Calculation**:
```javascript
// Plan OTD = Working days from Start to Plan End
customfield_10095 = dateDifference(startDate, plannedEndDate, actualEndDate, "start")

// Actual OTD = Working days from Start to Actual End
customfield_10094 = dateDifference(startDate, plannedEndDate, actualEndDate, "end")

// OTD Variance % = ((Actual - Plan) / Plan) * 100
customfield_10096 = ((customfield_10094 - customfield_10095) / customfield_10095) * 100
```

**Working Days Logic**:
- Only counts Monday to Friday
- Excludes weekends
- Excludes today if plan end date has passed

---

### 8. CAE Iteration Metrics (customfield_10608, 11003, 11036, 10607)
**Purpose**: Tracks CAE iteration efficiency

**Location**: Lines ~3035-3195

**Metrics**:
- `customfield_11036`: Iteration Standard Actual Hours
- `customfield_11003`: Iteration Actual Hours
- `customfield_10607`: Iteration Count
- `customfield_10608`: CAE Iteration Percentage

**Formula**:
```javascript
CAE Iteration % = (Iteration Actual / (Standard + Actual)) * 100
                = (customfield_11003 / (customfield_11036 + customfield_11003)) * 100
```

---

## Data Flow & Propagation

### 1. Phase Creation Flow
```
User Input (UI)
    ↓
setData() → taskQueue
    ↓
Activity Creation (create-activity)
    ├─ Create Milestone Issues
    ├─ Create Activity Groups
    ├─ Create Activities
    ├─ Create Work Orders
    └─ Create Tasks
    ↓
calculateAndUpdateField()
    └─ Sums child standard hours → updates parent customfield_10061
```

### 2. Worklog Update Flow
```
Worklog Logged
    ↓
enqueueUpdateLog()
    ↓
updateLog()
    ├─ Fetch worklog hours
    ├─ Update issue custom fields:
    │  ├─ DE Activity = sum of DE worklogs
    │  ├─ COO Activity = sum of COO worklogs
    │  └─ TDL Activity = sum of TDL worklogs
    ↓
propagateActivityHours()
    └─ Recursively sum child hours and update parent
```

### 3. KPI Update Flow
```
Issue Updated
    ↓
enqueueUpdateKPI()
    ↓
updateKPI()
    ├─ Calculate: Actual Hours = DE + COO + TDL
    ├─ Calculate: DFS, EWR, Rework Ratio
    ├─ Calculate: DED, WO-FTR
    ├─ Calculate: OTD metrics
    ├─ Calculate: CAE Iteration
    ↓
propagateActivityHoursBulk()
    └─ Recursively propagate calculated values up hierarchy
```

### 4. Propagation Logic
**Function**: `propagateActivityHoursBulk()` - Lines ~1965-2028

**Process**:
1. Fetch all child issues linked with "Hierarchy link (WBSGantt)"
2. Sum custom field values across all children
3. Update parent with summed values
4. Recursively propagate to grandparent

**Example**:
```
Activity Group
├─ Activity 1 → customfield_10065: 10
├─ Activity 2 → customfield_10065: 15
└─ Activity 3 → customfield_10065: 5
    ↓
Activity Group gets: customfield_10065 = 10 + 15 + 5 = 30
    ↓
Phase gets summed total
    ↓
Project gets summed total
```

---

## Issue Type Hierarchy & Field Updates

### Issue Type Hierarchy
```
Project (parent)
├─ Phase (child of Project)
│  ├─ Milestone (child of Phase)
│  └─ Activity Group (child of Phase)
│     ├─ Activity (child of Activity Group)
│     │  ├─ Work Order (child of Activity)
│     │  │  └─ Task (child of Work Order)
│     │  │     └─ Worklog (effort tracking)
│     │  └─ CAE Iteration Activities (for engineering simulation)
│     └─ ITERATIONS Group (special Activity Group)
│        └─ Iteration Activities
```

### Field Update Rules by Issue Type

**Project / Phase / Activity Group**:
- Sum child values
- Calculate aggregated KPIs (DFS, EWR, Rework)
- No individual metrics

**Activity**:
- Receives planned hours (customfield_10061)
- Tracks actual hours when Closed (customfield_10093, 10971)
- Calculates DFS when status changes
- Handles CAE iterations

**Work Order**:
- Aggregates Task actual hours (customfield_10082 = COO)
- Calculates WO-FTR

**Task**:
- Stores worklog hours (customfield_10081 = DE)
- When Closed: updates estimation field
- Calculates schedule variance

---

## Percentages Applied

### 2D Drawing Percentages
```javascript
{
  "TDL": 30,    // 30% effort for TDL
  "COO": 35,    // 35% effort for COO
  "DE": 35      // 35% effort for DE
}
```

### Data Management Percentages
```javascript
{
  "TDL": 25,    // 25% effort for TDL
  "COO": 25,    // 25% effort for COO
  "DE": 50      // 50% effort for DE
}
```

### Industrialization Percentages
```javascript
{
  "_3DModification": 15,  // 15% increment
  "_2DModification": 15,  // 15% increment
  "dataManagement": 15    // 15% increment
}
```

---

## Summary Table - Calculation Points

| Metric | Formula | Updated On | Scope |
|---|---|---|---|
| **Actual Hours** | DE + COO + TDL | Any worklog or field update | All issue types |
| **Standard Hours** | TDL + COO + DE (planned) | Phase creation | All issue types |
| **DFS** | ((Actual - Standard) / Standard) * 100 | Activity closure | Activity, Group, Phase, Project |
| **EWR** | (Extra Work / Actual) * 100 | Any field update | Project, Phase, Activity Group |
| **Rework** | (Rework / Actual) * 100 | Any field update | Project, Phase, Activity Group |
| **DED** | ((Actual DE - Est DE) / Est DE) * 100 | Task closure | Task level |
| **WO-FTR** | Average(WO values) * 100 | Work Order update | Phase, Activity Group |
| **OTD** | ((Actual - Plan) / Plan) * 100 | Date field update | Activity, WO, Task |
| **CAE Iteration** | (Iter Actual / (Std + Actual)) * 100 | Activity update | Activity with iterations |

---

## Additional Calculations

### 1. Standard Hour Sum Across Parts
When multiple product parts are selected:
```javascript
// In generateADF() function
parts.forEach((part) => {
  if (jsonData[part].subactivity) {
    Object.entries(jsonData[part].subactivity).forEach(([key, values]) => {
      subactivitySummary[key].TDL += values.TDL || 0;
      subactivitySummary[key].COO += values.COO || 0;
      subactivitySummary[key].DE += values.DE || 0;
    });
  }
});
```

### 2. Loop Multiplication for Quoted Hours
When milestones/activities have multiple loops:
```javascript
// In generateADF() - Quoted column shows:
Quoted Hours = Base Hours * Number of Loops

// Example:
If Loop count = 3 and DE = 10:
Quoted DE = 10 * 3 = 30 hours
```

### 3. Outward Issue Count
Tracks the number of child issues:
```javascript
const outwardIssuesCount = data.fields.issuelinks.filter(
  (link) => link.type.name === "Hierarchy link (WBSGantt)" && link.outwardIssue
).length;
// Updated to: customfield_10607
```

---

## Error Handling & Edge Cases

### Null/Zero Handling
```javascript
// Division by zero prevention
DFS = fieldValue10093 != 0 
      ? ((fieldValue10093 - fieldValue10971) / fieldValue10971) * 100
      : null;

// Default to 0 when null
const value = fieldValue || 0;
```

### Status-Dependent Calculations
- **DFS** calculated only when Activity status = "Closed"
- **Task Estimation** updated only when Task status = "Closed"
- **Actual Closing Hours** populated only when Activity status = "Closed"

### Retry Logic
- **Rate Limit Handling**: Exponential backoff (10s, 20s, 30s...capped at 30s)
- **Max Retries**: 5-10 attempts depending on operation
- **Jitter**: 10% randomization to prevent thundering herd

---

## Code References

### Key Function Locations
| Function | Line Range | Purpose |
|---|---|---|
| `calculateSumsWithTotal` | 432-464 | Aggregates metrics |
| `processJsonWithPhase` | 1544-1587 | Applies phase multipliers |
| `update2DDrawingData` | 1589-1638 | 2D adjustment |
| `updateDataManagement` | 1640-1687 | Data mgmt adjustment |
| `updateIndustrializationValues` | 1689-1718 | Industrialization adjust |
| `propagateActivityHours` | 1862-1922 | Recursive propagation |
| `propagateActivityHoursBulk` | 1965-2028 | Bulk field propagation |
| `updateLog` | 1983-2226 | Worklog hour updates |
| `updateKPI` | 2253-3251 | KPI calculations |
| `dateDifference` | 2203-2240 | Working days calculation |

---

## Version Notes
- Document created for: Phase Creation Production System
- Calculated date: May 2026
- Primary focus: Backend calculation logic (index.js)
- Applicable to: Project, Phase, Activity, Work Order, and Task issue types

