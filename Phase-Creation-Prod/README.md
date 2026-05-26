# Phase Creation System - Complete Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture & Flow](#architecture--flow)
3. [Core Components](#core-components)
4. [API Endpoints (Resolvers)](#api-endpoints-resolvers)
5. [Calculations & Formulas](#calculations--formulas)
6. [Event Handlers & Listeners](#event-handlers--listeners)
7. [Custom Fields Reference](#custom-fields-reference)
8. [Data Models](#data-models)

---

## System Overview

### Purpose
This is a **Jira Forge App** that automates the creation and management of phases, activities, work orders, and tasks within Jira. It integrates with Jira's REST API to create hierarchical issue structures and manage hour tracking, KPIs, and project metrics.

### Key Technologies
- **Forge Framework**: Atlassian's serverless platform
- **Jira REST API v3**: For issue management and data retrieval
- **Pako**: For GZIP compression/decompression of data
- **Message Queues**: For async processing (task-queue, kpi-update-queue, log-update-queue, etc.)

### System Type
Enterprise project management automation system for the **Antolin** company, tracking phases like Proto, Serie, and Industrialization.

---

## Architecture & Flow

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Jira Issue Hierarchy                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Project (Top Level)                                     │   │
│  │  - Contains product parts, customers                     │   │
│  └──────────────────┬───────────────────────────────────────┘   │
│                     │                                             │
│         ┌───────────┴───────────┐                                │
│         ▼                       ▼                                 │
│  ┌─────────────────┐  ┌──────────────────┐                      │
│  │ Phase Issue     │  │ Phase Issue      │                      │
│  │ (Proto/Serie)   │  │ (Industrialization)                     │
│  └────────┬────────┘  └──────────────────┘                      │
│           │                                                      │
│           ├─► Milestone Group 1 (with loops)                    │
│           │                                                      │
│           └─► Activity Groups (Group 1, Group 2, etc.)          │
│               │                                                  │
│               └─► Activity (Loop 1, Loop 2, Extra Work, Re-Work)│
│                   │                                              │
│                   └─► Work Order (WO1)                          │
│                       │                                          │
│                       └─► Task (Task 1)                         │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ITERATIONS Activity Group (CAE Iterations)               │   │
│  │ - Contains iterative versions of activities              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌──────────────────┐
│   UI Component   │
│  (React App)     │
└────────┬─────────┘
         │ Sends compressed JSON data
         ▼
┌──────────────────────────────────────┐
│  "create-activity" Resolver          │
│  - Decompresses data (pako)          │
│  - Parses JSON                       │
│  - Stores in Forge Storage           │
└────────┬─────────────────────────────┘
         │
         ├─► Create Phase/Milestone Issues
         │
         ├─► Create Activity Groups
         │
         ├─► Create Activities (Standard, Extra Work, Re-Work)
         │
         ├─► Create Work Orders
         │
         └─► Create Tasks
              │
              ▼
         ┌──────────────────────┐
         │  Link Issues Using   │
         │  "Hierarchy Link     │
         │  (WBSGantt)" Type    │
         └──────────────────────┘
```

### Main Flow Summary

1. **Phase Creation**: User submits phase data (Proto, Serie, Industrialization)
2. **Data Storage**: Compressed data stored in Forge Storage
3. **Issue Generation**: Create hierarchical issue structure
4. **Linking**: Connect parent-child issues using "Hierarchy link (WBSGantt)"
5. **Hour Calculation**: Calculate standard hours, extra work, rework
6. **KPI Updates**: Update metrics when worklog hours are recorded
7. **Propagation**: Roll-up calculations from task → activity → phase

---

## Core Components

### 1. **Data Compression/Decompression**

#### `uint8ArrayToBase64(uint8Arr)`
Converts a Uint8Array to Base64 string for storage.
- Uses chunking to avoid "maximum call stack exceeded"
- Chunk size: 0x8000 (32KB)

#### `base64ToUint8Array(base64)`
Converts Base64 string back to Uint8Array.

### 2. **Jira API Wrapper Functions**

#### `retryJiraApiCall(apiCall, maxRetries = 5, baseDelayMs = 10000)`
**Purpose**: Robust Jira API call wrapper with exponential backoff

**Parameters**:
- `apiCall`: Function that returns API promise
- `maxRetries`: Maximum retry attempts (default: 5)
- `baseDelayMs`: Base delay in milliseconds (default: 10000)

**Logic**:
- Returns immediately on 400, 404 status
- Retries on 429 (rate limit) and 5xx errors
- Uses Retry-After header if available
- Falls back to exponential backoff: $2^{retryCount} \times baseDelayMs$
- Caps max delay at 30 seconds
- Adds 10% jitter to prevent thundering herd

#### `fetchLinkedIssues(issueKey)`
Retrieves all linked issues (inward and outward) for a given issue.

#### `fetchIssue(issueKey)`
Fetches complete issue data including all custom fields.

#### `createIssue({ projectId, issueTypeId, summary, ...fields })`
Creates a new Jira issue with specified fields.

#### `linkIssues({ inwardIssueKey, outwardIssueKey }, maxRetries = 3)`
Links two issues using "Hierarchy link (WBSGantt)" relationship.
- Includes 1.2 second delay before linking for Jira indexing
- Dedicated retry logic with exponential backoff (2s, 4s, 8s)

### 3. **Phase Creation Logic**

#### `resolver.define("create-activity")`
**Triggered by**: UI component submission

**Input Data Structure**:
```javascript
{
  issueKey: "PROJECT-123",          // Parent issue
  base64Data: "H4sICG...",         // Compressed JSON
  
  // Decompressed structure:
  {
    phaseName: { value: "Proto" },
    milestones: {
      "Milestone1|Type1": { 
        order: "01", 
        checked: true, 
        loops: 2 
      }
    },
    activities: {
      "Activity1|Type1": {
        order: "10",
        checked: true,
        standardLoop: 1,
        extraWorkLoop: 0,
        reWorkLoop: 0,
        caeIterationLoop: 0,
        TDL: 8.5,
        COO: 1.5,
        DE: 2.0,
        standard: 12.0,
        loop: 1,
        subactivity: {
          "SubActivity1": {
            "Proto": 1,
            "Serie": 2,
            TDL: 8.5,
            COO: 1.5,
            DE: 2.0,
            order: 1
          }
        }
      }
    },
    totalHours: 150.5,
    extraWork: {...},
    _3DModification: {...},
    _2DModification: {...},
    dataManagement: {...}
  }
}
```

**Process**:
1. Decompress and parse data from Base64
2. Store compressed data in Forge Storage
3. Fetch parent issue details (project, product parts, assignees)
4. Create milestones for each checked milestone with loops
5. Create activity groups for each activity
6. For each activity, create:
   - Standard loops (Line 1, Line 2, etc.)
   - Extra Work loops (with null hours)
   - Re-Work loops (with null hours)
   - CAE Iteration group (if enabled)
7. For each activity, create Work Order (WO1) and Task (Task 1)
8. Link all issues using Hierarchy link
9. Generate ADF table with subactivity details

### 4. **Issue Hierarchy Creation**

#### `processLoops(loopType, startLoop, loopCount, additionalProps, type)`

**Purpose**: Creates activity issues with their work orders and tasks

**Parameters**:
- `loopType`: "" (Standard), "| Extra Work", "| Re-Work"
- `startLoop`: Starting loop number
- `loopCount`: Number of loops to create
- `additionalProps`: Additional properties (activity info, hours, etc.)
- `type`: "Loop" or "Iter"

**Summary Pattern**:
```
{order} | {activity0} | {activity1} | {type} {currentLoop} {loopType}
```

**Custom Fields Set**:
- **customfield_10077** (TDL): Set to null for Extra Work/Re-Work
- **customfield_10075** (COO): Set to null for Extra Work/Re-Work
- **customfield_10076** (DE): Set to null for Extra Work/Re-Work
- **customfield_10061** (Standard Hours): Set to null for Extra Work/Re-Work
- **customfield_10059** (2D Loop Count): Set for 2D Drawing activities
- **customfield_10970** (Phase)
- **customfield_10078** (Project Key)
- **assignee**: Based on customfield_10045/10046/10079/10080

#### Activity Group Structure
```
Activity Group
├── Activity (Loop 1)
│   ├── Work Order (WO1)
│   │   └── Task (Task 1)
│   └── (Nested work items)
├── Activity (Loop 2)
│   └── Work Order (WO1)
│       └── Task (Task 1)
├── Activity (Extra Work)
│   └── Work Order (WO1)
│       └── Task (Task 1)
└── Activity (Re-Work)
    └── Work Order (WO1)
        └── Task (Task 1)
```

### 5. **ADF Table Generation**

#### `generateADF(jsonData, parts, phase)`

**Purpose**: Creates an Atlassian Document Format (ADF) table for issue description

**Logic**:
1. Process selected product parts
2. Extract subactivities from each part
3. Aggregate values (DE, COO, TDL) by subactivity
4. Sort by order field
5. Create two-section table:
   - **Standard Column**: Loop=1, values as-is
   - **Quoted Column**: Values multiplied by actual loop count

**Table Structure**:
```
┌─────────────────────────────────────────────────────────────────┐
│ Subactivity │ Standard              │ Quoted                    │
│             ├─────┬────┬────┬────┤ ├─────┬────┬────┬────┤
│             │Loop │ DE │COO │TDL │ │Loop │ DE │COO │TDL │
├─────────────┼─────┼────┼────┼────┼─┼─────┼────┼────┼────┤
│ Subact1     │ 1   │5.5 │0.8 │2.0 │ │ 2   │11.0│1.6 │4.0 │
│ Subact2     │ 1   │3.2 │0.5 │1.2 │ │ 2   │6.4 │1.0 │2.4 │
└─────────────┴─────┴────┴────┴────┴─┴─────┴────┴────┴────┘
```

---

## API Endpoints (Resolvers)

### Phase Data Management

#### `resolver.define("getData")`
**Endpoint**: `getData`
**Input**: `{ issueKey, phase }`
**Output**: Stored phase data (Base64 compressed JSON)
**Purpose**: Retrieve previously stored phase configuration

#### `resolver.define("setData")`
**Endpoint**: `setData`
**Input**: Phase configuration payload
**Output**: `{ success: true, message: "..." }`
**Purpose**: Queue phase data for processing

#### `resolver.define("create-activity")`
**Endpoint**: `create-activity`
**Input**: `{ issueKey, base64Data }`
**Output**: `{ success: true, message: "..." }`
**Purpose**: Main entry point for creating phase hierarchy

### Configuration Data

#### `resolver.define("getConfigData")`
**Endpoint**: `getConfigData`
**Input**: `{ issue, phase, key }`
**Output**: Activity configuration data
**Purpose**: Fetch activity data with phase-based calculations

**Logic**:
1. If `key == "Activity"`, fetch issue details to get:
   - `customfield_10073`: Product (key)
   - `customfield_10838`: Customer
   - `customfield_10074`: Product Parts list
2. Apply phase-based multipliers:
   - Call `processJsonWithPhase()` to multiply TDL/COO/DE by phase value
   - Update 2D Drawing data with percentages
   - Update Data Management calculations
   - For Industrialization phase, apply industrialization percentages
3. Calculate section totals using `calculateSumsWithTotal()`
4. Return product and activity data

#### `resolver.define("projectSettingsFunction")`
**Endpoint**: `projectSettingsFunction`
**Input**: Project context
**Output**: Project details
**Purpose**: Fetch project information

### Quotation Management

#### `resolver.define("getQuotationData")`
**Endpoint**: `getQuotationData`
**Input**: `{ issue }`
**Output**: Quotation data for product
**Purpose**: Retrieve cached or compressed quotation data

#### `resolver.define("saveQuotationData")`
**Endpoint**: `saveQuotationData`
**Input**: `{ issue, data }`
**Output**: `{ success: true }`
**Purpose**: Save quotation data to storage

#### `resolver.define("getProductData")`
**Endpoint**: `getProductData`
**Output**: All product data
**Purpose**: Get complete product dataset

#### `resolver.define("updateProductData")`
**Endpoint**: `updateProductData`
**Input**: `{ updatedData }`
**Output**: `{ success: true }`
**Purpose**: Update product data storage

---

## Calculations & Formulas

### 1. **Phase-Based Hour Multiplication**

#### `processJsonWithPhase(data, phase)`

**Purpose**: Multiply hours by phase multiplier (Proto or Serie value)

**Algorithm**:
```javascript
For each activity in data:
  For each roof type in activity:
    If roof has subactivities:
      Reset TDL, COO, DE to 0
      For each subactivity:
        multiplier = subactivity[phase] || 0
        TDL += subactivity.TDL × multiplier
        COO += subactivity.COO × multiplier
        DE += subactivity.DE × multiplier
    Else:
      multiplier = roofData[phase] || 0
      TDL *= multiplier
      COO *= multiplier
      DE *= multiplier
```

**Example**:
```
Base TDL = 8.5, COO = 1.5, DE = 2.0
Phase "Proto" value = 1
Phase "Serie" value = 2

For Proto:
  TDL = 8.5 × 1 = 8.5
  COO = 1.5 × 1 = 1.5
  DE = 2.0 × 1 = 2.0

For Serie:
  TDL = 8.5 × 2 = 17.0
  COO = 1.5 × 2 = 3.0
  DE = 2.0 × 2 = 4.0
```

### 2. **2D Drawing Data Calculation**

#### `update2DDrawingData(data, values, product, percentages, phase)`

**Purpose**: Calculate 2D drawing hours based on percentages

**Formula**:
$$TDL = \frac{data[key][product][phase] \times value \times percentages[TDL] \times percentages[phase]}{10000}$$

$$COO = \frac{data[key][product][phase] \times value \times percentages[COO] \times percentages[phase]}{10000}$$

$$DE = \frac{data[key][product][phase] \times value \times percentages[DE] \times percentages[phase]}{10000}$$

**Where**:
- `value`: 2D Drawing data value (e.g., 50)
- `percentages[TDL]`: TDL percentage (e.g., 15%)
- `percentages[phase]`: Phase percentage (e.g., 100%)

**Example**:
```
Phase value = 1 (Proto)
2D value = 50
TDL percentage = 15%
Phase percentage = 100%

TDL = (1 × 50 × 15 × 100) / 10000 = 7.5
```

### 3. **Data Management Calculation**

#### `updateDataManagement(data, values, product, percentages, phase)`

Similar formula to 2D Drawing:

$$Hours = \frac{data[key][product][phase] \times value \times percentages[Hours] \times percentages[phase]}{10000}$$

### 4. **Industrialization Values**

#### `updateIndustrializationValues(json1, json2, detailedJson, percentages)`

**Purpose**: Calculate industrialization hours based on sum of proto + serie

**Algorithm**:
```javascript
For each industrialization category (3D, Data Management, 2D):
  summedValue = json1[category] + json2[category]
  percentage = percentages[category]
  increment = (percentage / 100) × summedValue
  detailedJson[category].standard = increment
  detailedJson[category].DE = increment
```

**Example**:
```
Proto 3D = 10 hours
Serie 3D = 15 hours
3D percentage = 15%

Industrialization 3D = (15 / 100) × (10 + 15) = 3.75 hours
```

### 5. **Section Totals Calculation**

#### `calculateSumsWithTotal(data, keysToConsider)`

**Purpose**: Aggregate hours from selected product parts

**Formula**:
$$TDL_{total} = \sum_{part \in keysToConsider} TDL_{part}$$

$$COO_{total} = \sum_{part \in keysToConsider} COO_{part}$$

$$DE_{total} = \sum_{part \in keysToConsider} DE_{part}$$

$$standard = TDL_{total} + COO_{total} + DE_{total}$$

**Implementation**:
```javascript
For each section:
  TDL = sum of all selected parts' TDL
  COO = sum of all selected parts' COO
  DE = sum of all selected parts' DE
  total = 0
  standard = TDL + COO + DE
```

### 6. **Actual Hours Aggregation**

#### `calculateAndUpdateField(parentIssueKey)`

**Purpose**: Sum standard hours from all child issues and update parent

**Formula**:
$$totalSum = \sum_{child} customfield\_10061$$

**Process**:
1. Fetch all outward issues (children)
2. For each child, get customfield_10061 (Standard Hours)
3. Sum all values
4. Update parent's customfield_10061 with rounded sum

### 7. **KPI Calculations**

#### Actual Hours (Aggregated)
$$Actual\_Hours = customfield\_10083 + customfield\_10082 + customfield\_10081$$

where:
- 10083: TDL Actual Hours
- 10082: COO Actual Hours
- 10081: DE Actual Hours

#### Design Deviation Ratio (DFS)
**For Activity (when Closed)**:
$$DFS = \frac{(Actual\_Close\_Hours - Standard\_Hours)}{Standard\_Hours} \times 100$$

**For Activity Group/Phase/Project**:
$$DFS = \frac{(Actual\_Close\_Hours - Standard\_Hours)}{Standard\_Hours} \times 100$$

**Special Case**: If Actual = Standard, then DFS = 0

#### Extra Work Ratio (EWR)
$$EWR = \frac{Extra\_Work\_Hours}{Total\_Actual\_Hours} \times 100$$

**Applied to**: Project, Phase, Activity Group

#### Rework Ratio
$$Rework = \frac{Rework\_Hours}{Total\_Actual\_Hours} \times 100$$

**Applied to**: Project, Phase, Activity Group

#### Designer Engineering Deviation (DED)
$$DED = \frac{(Actual\_DE - Estimated\_DE)}{Estimated\_DE} \times 100$$

#### On-Time Delivery (OTD)

**Activity OTD (End)**:
$$OTD_{end} = countBusinessDays(StartDate, ActualEndDate)$$

**Activity OTD (Plan)**:
$$OTD_{plan} = countBusinessDays(StartDate, PlannedEndDate)$$

**OTD Variance**:
$$OTD\_Variance = \frac{(OTD_{end} - OTD_{plan})}{OTD_{plan}} \times 100$$

#### Business Days Calculation
```javascript
function dateDifference(startDate, plannedEndDate, actualEndDate, mode):
  Count only Monday-Friday (day >= 1 && day <= 5)
  
  if mode == "start":
    endDate = plannedEndDate
  else:
    endDate = actualEndDate
  
  return count of business days between startDate and endDate
```

#### CAE Iteration Ratio
$$CAE\_Iteration = \frac{Iteration\_Actual\_Hours}{Standard + Iteration\_Actual\_Hours} \times 100$$

#### First Time Right (FTR)
$$WO\_FTR = \frac{\sum WO\_FTR\_Values}{count\_of\_Work\_Orders}$$

$$FTR\% = WO\_FTR \times 100$$

### 8. **Loop Numbering Logic**

**Starting Loop Calculation**:
```
totalStandard = count of existing standard activities
totalExtraWork = count of existing extra work activities
totalReWork = count of existing rework activities

For Standard: startLoop = totalStandard
For Extra Work: startLoop = standardLoop + totalExtraWork + totalReWork
For Re-Work: startLoop = standardLoop + totalExtraWork + totalReWork + (extraWorkLoop - totalExtraWork)
```

**Current Loop Number**:
```
currentLoop = startLoop + iteration
```

---

## Event Handlers & Listeners

### 1. **Worklog Update Handler**

#### `enqueueUpdateLog(event, context)` & `updateLog(event, context)`

**Trigger**: Worklog added/updated on an issue

**Process**:
1. Check if project = "CWO" (Prod) or "CDEMO" (Dev)
2. Determine issue type (Task, Work Order, Activity)
3. Calculate total worklogged hours:
   $$Total = \sum_{worklog} \frac{timeSpentSeconds}{3600}$$

**Update Logic by Issue Type**:

**Task**:
- Update customfield_10081 (DE Activity Hours)
- Propagate to parent (Work Order)

**Work Order**:
- Update customfield_10082 (COO Actual Hours)
- Propagate to parent (Activity)

**Activity/Activity Group**:
- Update customfield_10083 (TDL Actual Hours)
- Propagate to parent

### 2. **KPI Update Handler**

#### `enqueueUpdateKPI(event, context)` & `updateKPI(event, context)`

**Trigger**: Issue field change

**Main Calculations Performed**:

1. **Aggregate Actual Hours**
2. **Calculate DFS** (Design Deviation Ratio)
3. **Calculate EWR** (Extra Work Ratio)
4. **Calculate Rework Ratio**
5. **Calculate DED** (Designer Engineering Deviation)
6. **Calculate OTD Metrics**
7. **Update Parent Fields** using `propagateActivityHoursBulk()`

**Field Dependencies**:
```javascript
customfield_10065 ← customfield_10083 + customfield_10082 + customfield_10081
customfield_10066 ← ((customfield_10093 - customfield_10971) / customfield_10971) × 100
customfield_10086 ← (customfield_10085 / customfield_10065) × 100
customfield_10070 ← (customfield_10084 / customfield_10065) × 100
customfield_10068 ← ((customfield_10972 - customfield_10092) / customfield_10092) × 100
```

### 3. **Propagation Functions**

#### `propagateActivityHours(currentIssueId, customFieldKey)`

**Purpose**: Roll up values from child to parent issues

**Algorithm**:
```
While current issue has parent:
  Sum = 0
  For each child of current issue:
    Sum += child[customFieldKey]
  
  Update current[customFieldKey] = Sum
  Move to parent
  Repeat
```

#### `propagateActivityHoursBulk(currentIssueId, customFieldKeys)`

**Purpose**: Roll up multiple fields in one operation

**Improvement**: Reduces API calls by updating all fields at once

#### `propagateIterCount(currentIssueId, customFieldKey)`

**Purpose**: Roll up iteration count excluding ITERATION issues

**Special Logic**:
```
Sum = 0
For each child of current issue:
  If child.summary does NOT include "ITERATION":
    Sum += child[customFieldKey]

Update current[customFieldKey] = Sum
```

### 4. **CAE Iteration Handler**

#### `getFilteredIterationIssues(activityIssueKey, summaryMatch)`

**Purpose**: Update CAE iteration percentages

**Process**:
1. Find Activity → Activity Group → Phase hierarchy
2. Locate ITERATIONS Activity Group
3. Find matching iteration activities
4. Calculate ratio:
   $$CAE\_Iter = \frac{Iteration\_Actual}{Standard\_Actual + Iteration\_Actual} \times 100$$
5. Update all iteration activities with ratio
6. Update Activity Group with aggregated values

### 5. **Scheduled Trigger Handler**

#### `trigger(context)` & `updateToday(context)`

**Purpose**: Update issue dates at scheduled times

**Process**:
1. Query issues where customfield_11168 (date field) < now()
2. Update those issues with today's date
3. Run periodically via Jira scheduled event

---

## Custom Fields Reference

### Time/Hours Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 10061 | Standard Hours | Number | Planned/estimated hours |
| 10065 | Actual Hours | Number | Sum of DE + COO + TDL actual |
| 10081 | DE Actual Hours | Number | Designer Engineering actual |
| 10082 | COO Actual Hours | Number | Change Order actual |
| 10083 | TDL Actual Hours | Number | Technology Dev Lead actual |
| 10084 | Extra Work | Number | Extra work actual hours |
| 10085 | Rework | Number | Rework actual hours |

### Estimation Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 10075 | COO | Number | COO estimate |
| 10076 | DE | Number | DE estimate |
| 10077 | TDL | Number | TDL estimate |
| 10056 | Task Estimation | Number | Estimated task hours |

### KPI Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 10066 | DFS | Number | Design failure deviation % |
| 10068 | DED % | Number | Designer engineering deviation % |
| 10070 | EWR | Number | Extra work ratio % |
| 10086 | Rework Ratio | Number | Rework ratio % |
| 10092 | DED Calc1 | Number | DE estimation value |
| 10093 | DFS Act Hrs | Number | Actual hours for DFS calc |
| 10094 | Activity OTD | Number | On-time delivery (end) |
| 10095 | Activity Plan OTD | Number | On-time delivery (plan) |
| 10096 | OTD Variance | Number | OTD variance % |

### Date Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 10015 | Start Date | Date | Activity start |
| 10053 | End Date | Date | Planned end date |
| 10009 | Actual End | Date | Actual end date |
| 11168 | Scheduled Date | Date | For automated updates |

### Project/Product Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 10073 | Product-BU | Select | Product/BU identifier |
| 10074 | Product Parts | Multiselect | Selected product parts |
| 10078 | Project Key | Text | Parent project key |
| 10838 | Customer | Select | Customer identifier |

### Iteration Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 11003 | Iter Act Hour | Number | Iteration actual hours |
| 11036 | Iter Std Act Hour | Number | Iteration standard actual |
| 10607 | Iter count | Number | Iteration count |
| 10608 | CAE Iteration | Number | CAE iteration percentage |

### 2D Drawing Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 10059 | 2D Loop | Number | 2D drawing loop count |

### Quality/Performance Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 10100 | WO-FTR | Number | First time right (0-1) |
| 10101 | FTR % | Number | FTR percentage |

### Assignment Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 10045 | Manager 1 | User | Hierarchy manager |
| 10046 | Manager 2 | User | Activity manager |
| 10047 | Manager 3 | User | Task manager |
| 10079 | 2D Manager | User | 2D drawing manager |
| 10080 | 2D Task Manager | User | 2D task manager |

### Other Fields
| Field ID | Name | Type | Purpose |
|----------|------|------|---------|
| 10970 | Phase | Select | Phase (Proto/Serie/etc) |
| 10039 | Project Summary | Text | Parent project summary |
| 10050 | Project Field | Text | Project metadata |
| 10839 | Project Field | Text | Project metadata |
| 10871 | Activity Ref | Text | Activity reference |
| 10872 | Reporting Manager | User | Escalation manager |
| 10971 | Close Std Hrs | Number | Standard hours at close |
| 10972 | Close DE Hrs | Number | DE hours at close |
| 10079 | 2D Manager | User | 2D discipline manager |
| 10080 | 2D Task Manager | User | 2D task manager |

---

## Data Models

### Input Data Structure (JSON)

```javascript
{
  "phaseName": {
    "value": "Proto",        // or "Serie", "Industrialization"
    "label": "Prototype"
  },
  
  "milestones": {
    "Design|Type1|Design Review": {
      "order": "01",         // Sorting order
      "checked": true,       // Include in phase
      "loops": 2             // Create 2 milestone loops
    }
  },
  
  "activities": {
    "Activity1|CAE": {
      "order": "10",
      "checked": true,
      "standardLoop": 1,     // Number of standard loops
      "extraWorkLoop": 0,    // Number of extra work loops
      "reWorkLoop": 0,       // Number of rework loops
      "caeIterationLoop": 0, // Number of CAE iterations
      "TDL": 8.5,           // TDL hours
      "COO": 1.5,           // COO hours
      "DE": 2.0,            // DE hours
      "standard": 12.0,     // Total standard (sum)
      "loop": 1,            // Loop multiplier for phase
      
      "subactivity": {
        "Subactivity1": {
          "Proto": 1,       // Multiplier for Proto phase
          "Serie": 2,       // Multiplier for Serie phase
          "TDL": 8.5,
          "COO": 1.5,
          "DE": 2.0,
          "order": 1
        }
      }
    }
  },
  
  "totalHours": 150.5,
  
  "extraWork": {
    // Structure: same as activities
  },
  
  "_3DModification": {
    // 3D CAD modification hours
    "key": 5.0
  },
  
  "_2DModification": {
    // 2D drawing modification hours
    "key": 3.5
  },
  
  "dataManagement": {
    // Data management hours
    "key": 2.0
  }
}
```

### Stored Issue Structure

```
Project (customfield_10074: [Product Parts])
  │
  ├─► Phase Issue (customfield_10970: phase)
  │    │  customfield_10061: total standard hours
  │    │
  │    ├─► Milestone Group Loop 1
  │    │    └─► Milestone Group Loop 2
  │    │
  │    └─► Activity Group 1 (customfield_10061: group hours)
  │         │
  │         ├─► Activity (Loop 1) [customfield_10061]
  │         │    │
  │         │    ├─► Work Order [customfield_10082]
  │         │    │    └─► Task [customfield_10081]
  │         │    │
  │         │    └─► [customfield_10065: actual hours]
  │         │
  │         ├─► Activity (Loop 2)
  │         ├─► Activity (Extra Work)
  │         └─► Activity (Re-Work)
  │
  └─► ITERATIONS Activity Group
       ├─► Iteration Activity 1 [customfield_10608: %, customfield_11003: actual]
       └─► Iteration Activity 2 [customfield_10608: %, customfield_11003: actual]
```

### Queue Messages

```javascript
// Task Queue
{
  issueKey: "PROJECT-123",
  phase: "Proto",
  base64Data: "H4sICG..."
}

// KPI Update Queue
{
  call: {
    payload: {
      issue: { id: "123456", key: "PROJECT-123" }
    }
  }
}

// Log Update Queue
{
  worklog: { 
    issueId: "123456",
    id: "worklog-id",
    timeSpentSeconds: 28800  // 8 hours
  }
}
```

---

## Summary

This system provides:

1. **Hierarchical Issue Management**: Automatically creates multi-level Jira structures
2. **Phase-Based Calculations**: Applies phase multipliers to hours
3. **Automatic KPI Calculation**: Computes metrics like DFS, EWR, OTD
4. **Real-time Propagation**: Rolls up values through hierarchy
5. **Flexible Looping**: Supports standard, extra work, rework, and iterations
6. **Data Compression**: Efficiently stores large JSON configurations
7. **Robust API Handling**: Implements retry logic with exponential backoff

The system is production-grade with error handling, rate limiting, and queue-based async processing.
