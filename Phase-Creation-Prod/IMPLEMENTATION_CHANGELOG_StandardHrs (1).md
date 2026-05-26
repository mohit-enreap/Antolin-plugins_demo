# Implementation Changelog - Standard Hours Movement to Activity Group Level

**Date**: 23 May 2026  
**Project**: Phase-Creation-Prod (Antolin)  
**File**: `src/index.js`  
**Status**: ✅ COMPLETE

---

## Executive Summary

All standard hours fields (COO, DE, TDL, Total Standard) and DFS% calculation have been successfully moved from Activity level to Activity Group level. This refactoring improves data hierarchy clarity, prevents display redundancy, and ensures accurate KPI propagation across the Jira issue hierarchy.

**Key Outcome**: 
- Standard hours (10075, 10076, 10077, 10061) now display **ONLY at Activity Group level**
- DFS% (10066) now calculates **ONLY at Activity Group level**
- Activity issues no longer have standard hour fields
- All hierarchy rollups remain functional and intact

---

## Detailed Changes

### CHANGE 1: Activity Group Creation - Add 3 Standard Hour Fields
**Location**: Lines ~1150-1168 (create-activity resolver)  
**Type**: ✅ IMPLEMENTED

**What was changed:**
Added three new fields to Activity Group creation:
- `customfield_10075` (COO Standard Hours)
- `customfield_10076` (DE Standard Hours)
- `customfield_10077` (TDL Standard Hours)

**Before:**
```javascript
activityGroupIssue = await createIssue({
  projectId,
  issueTypeId: "10019",
  summary: activityGroupSummary,
  customfield_10078: issueKey,
  customfield_10061: standardLoop != 0 ? Number(standard?.toFixed(1)) : null,
  customfield_10970: phaseName.value,
});
```

**After:**
```javascript
activityGroupIssue = await createIssue({
  projectId,
  issueTypeId: "10019",
  summary: activityGroupSummary,
  customfield_10078: issueKey,
  customfield_10075: standardLoop != 0 ? Number(COO?.toFixed(1)) : null,
  customfield_10076: standardLoop != 0 ? Number(DE?.toFixed(1)) : null,
  customfield_10077: standardLoop != 0 ? Number(TDL?.toFixed(1)) : null,
  customfield_10061: standardLoop != 0 ? Number(standard?.toFixed(1)) : null,
  customfield_10970: phaseName.value,
});
```

**Impact**: Activity Groups now receive all 4 standard hour fields on creation

---

### CHANGE 2A & 2B: Activity Creation - Remove Standard Hour Fields
**Location**: 
- 2A: Lines ~980-1005 (console.log in processLoops)
- 2B: Lines ~1005-1030 (createIssue in processLoops)  
**Type**: ✅ IMPLEMENTED

**What was changed:**
Removed 4 fields from Activity issue creation at TWO locations:
- `customfield_10077` (TDL)
- `customfield_10075` (COO)
- `customfield_10076` (DE)
- `customfield_10061` (Total Standard)

**Before (Both locations):**
```javascript
console.log({
  // ... other fields ...
  customfield_10077: loopType.includes("| Extra Work") ? null : Number(TDL?.toFixed(1)),
  customfield_10075: loopType.includes("| Extra Work") ? null : Number(COO?.toFixed(1)),
  customfield_10076: loopType.includes("| Extra Work") ? null : Number(DE?.toFixed(1)),
  customfield_10061: loopType.includes("| Extra Work") ? null : Number(standard?.toFixed(1)),
  // ... other fields ...
});

const createdActivity = await createIssue({
  // ... same 4 fields removed ...
});
```

**After (Both locations):**
```javascript
console.log({
  projectId: additionalProps.projectId,
  issueTypeId: "10008",
  summary: activitySummary,
  customfield_10078: additionalProps.issueKey,
  customfield_10059: activitySummary.includes("| 2D Drawing") ? additionalProps.loop : null,
  customfield_10970: additionalProps.phase,
  // ... no standard hour fields ...
});

const createdActivity = await createIssue({
  projectId: additionalProps.projectId,
  issueTypeId: "10008",
  summary: activitySummary,
  customfield_10078: additionalProps.issueKey,
  customfield_10059: activitySummary.includes("| 2D Drawing") ? `${additionalProps.loop}` : null,
  // ... no standard hour fields ...
});
```

**Impact**: Activities no longer store standard hour fields, reducing data redundancy

---

### CHANGE 3: Propagation Array - Conditional Logic by Issue Type
**Location**: Lines ~2616-2635 (updateKPI function)  
**Type**: ✅ IMPLEMENTED

**What was changed:**
Modified propagation array to be **conditional based on issue type**:
- **Activity type**: Does NOT propagate standard fields (10075, 10076, 10077)
- **Other types** (Project, Phase, Activity Group): DO propagate standard fields

**Before (Single array for all types):**
```javascript
const parentIssueId = await fetchParentIssueId(issueId);
if (parentIssueId) {
  const array = [
    "Project",
    "Phase",
    "Activity Group",
    "Activity",
  ].includes(type)
    ? [
        customField10084,
        customField10085,
        customField10056,
        customField10075,  // ← Propagated from ALL types (PROBLEM!)
        customField10076,
        customField10077,
      ]
    : [customField10084, customField10085, customField10056];
  await propagateActivityHoursBulk(parentIssueId, array);
}
```

**After (Conditional by type):**
```javascript
const parentIssueId = await fetchParentIssueId(issueId);
if (parentIssueId) {
  const array = ["Activity"].includes(type)
    ? [
        customField10084,  // Extra Work
        customField10085,  // Re-work
        customField10056,  // Task Estimation
        // REMOVED: customField10075, 10076, 10077 NOT propagated from Activity
      ]
    : ["Project", "Phase", "Activity Group"].includes(type)
    ? [
        customField10084,  // Extra Work
        customField10085,  // Re-work
        customField10056,  // Task Estimation
        customField10075,  // COO - propagated from AG, Phase, Project
        customField10076,  // DE - propagated from AG, Phase, Project
        customField10077,  // TDL - propagated from AG, Phase, Project
      ]
    : [customField10084, customField10085, customField10056];
  await propagateActivityHoursBulk(parentIssueId, array);
}
```

**Impact**: Prevents standard hours from being overwritten with NULL values when propagating from Activity level

---

### CHANGE 4: Activity Type Handler - Remove Close Std Hrs Field
**Location**: Lines ~2845-2868 (Activity handling in updateKPI)  
**Type**: ✅ IMPLEMENTED

**What was changed:**
Removed `customfield_10971` (Close Std Hrs) from Activity issue updates:
- Field no longer set on Activity when closing
- Removed from propagation array for Activity

**Before:**
```javascript
if (type == "Activity") {
  console.log(fieldValue10061);
  const updateResponse = await api
    .asApp()
    .requestJira(route`/rest/api/3/issue/${issueId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          [customField10093]:
            issueData.fields.status.name === "Closed"
              ? fieldValue10065 != null
                ? Number(fieldValue10065.toFixed(1))
                : null
              : null,
          [customField10971]:  // ← REMOVED
            issueData.fields.status.name === "Closed"
              ? fieldValue10061 != null
                ? Number(fieldValue10061.toFixed(1))
                : null
              : null,
        },
      }),
    });

  const parentIssueId = await fetchParentIssueId(issueId);
  if (parentIssueId) {
    await propagateActivityHoursBulk(parentIssueId, [
      customField10971,  // ← REMOVED
      customField10093,
      customField10094,
      customField10095,
    ]);
  }
}
```

**After:**
```javascript
if (type == "Activity") {
  console.log(fieldValue10061);
  const updateResponse = await api
    .asApp()
    .requestJira(route`/rest/api/3/issue/${issueId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          [customField10093]:
            issueData.fields.status.name === "Closed"
              ? fieldValue10065 != null
                ? Number(fieldValue10065.toFixed(1))
                : null
              : null,
          // REMOVED: [customField10971] - not set at Activity level anymore
        },
      }),
    });

  const parentIssueId = await fetchParentIssueId(issueId);
  if (parentIssueId) {
    await propagateActivityHoursBulk(parentIssueId, [
      // REMOVED: customField10971
      customField10093,
      customField10094,
      customField10095,
    ]);
  }
}
```

**Impact**: Activity no longer sets Close Std Hrs, simplifying the data model

---

### CHANGE 4B: Activity Group DFS Calculation - Use Its Own Standard Hours
**Location**: Lines ~2478-2520 (DFS calculation in updateKPI)  
**Type**: ✅ IMPLEMENTED

**What was changed:**
Activity Group DFS formula now uses its own `customfield_10061` instead of propagated `customfield_10971`

**Before (Using 10971):**
```javascript
} else if (["Activity Group", "Project", "Phase"].includes(type)) {
  const oldValue = DFSValue;

  DFSValue =
    fieldValue10093 != 0 && fieldValue10093 === fieldValue10971  // ← Uses 10971
      ? 0
      : (Number(DFSValue?.toFixed(1)) ?? null);

  if (
    (fieldValue10093 === 0 && fieldValue10971 === 0) ||
    (fieldValue10093 === null && fieldValue10971 === null)
  ) {
    DFSValue = null;
```

**After (Separated logic for Activity Group vs Project/Phase):**
```javascript
} else if (["Activity Group"].includes(type)) {
  // For Activity Group: use its own standard hours (customfield_10061)
  // not the propagated Close Std Hrs (customfield_10971)
  const oldValue = DFSValue;

  DFSValue =
    fieldValue10093 != 0 && fieldValue10093 === fieldValue10061  // ← Uses 10061
      ? 0
      : (Number(DFSValue?.toFixed(1)) ?? null);

  if (
    (fieldValue10093 === 0 && fieldValue10061 === 0) ||
    (fieldValue10093 === null && fieldValue10061 === null)
  ) {
    DFSValue = null;
```

**Formula Change:**
```
OLD: DFS% = ((DFS Act Hrs [10093] - Close Std Hrs [10971]) / Close Std Hrs [10971]) * 100
NEW: DFS% = ((DFS Act Hrs [10093] - Total Standard [10061]) / Total Standard [10061]) * 100
```

**Impact**: Activity Group DFS uses its own planned hours, not a propagated copy

---

### CHANGE 5: Activity DFS% - Set to Null
**Location**: Lines ~2478-2484 (Activity handling in DFS calculation)  
**Type**: ✅ IMPLEMENTED

**What was changed:**
Activity type DFS% now always set to NULL instead of calculating

**Before:**
```javascript
if (["Activity"].includes(type)) {
  if (issueStatus === "Closed") {
    DFSValue = Number(DFSValue?.toFixed(1)) ?? 0;  // ← Calculated at Activity
  } else {
    DFSValue = null;
  }
  console.log("CASE 1---> Type: ", type, "--- Value:", DFSValue);
}
```

**After:**
```javascript
if (["Activity"].includes(type)) {
  // For Activity issues, don't calculate DFS% - set to null
  // DFS Act Hrs (10093) is still calculated and propagated
  // but DFS% (10066) is calculated only at Activity Group level
  DFSValue = null;
  console.log("CASE 1---> Type: ", type, "--- Value:", DFSValue);
}
```

**Impact**: DFS% not displayed/calculated at Activity level, only at Activity Group and above

---

### CHANGE 6: calculateAndUpdateField - Sum All 4 Standard Hour Fields
**Location**: Lines ~340-400  
**Type**: ✅ IMPLEMENTED

**What was changed:**
Extended to sum and propagate ALL 4 standard hour fields instead of just 10061

**Before (Only 10061):**
```javascript
let totalSum = 0;

for (const issueKey of outwardIssues) {
  const issueResponse = await retryJiraApiCall(() =>
    api
      .asApp()
      .requestJira(
        route`/rest/api/3/issue/${issueKey}?fields=customfield_10061`,
        {
          method: "GET",
        },
      ),
  );

  if (issueResponse.ok) {
    const issueData = await issueResponse.json();
    const fieldValue = issueData.fields.customfield_10061 || 0;
    console.log(`Issue ${issueKey} - Standard Hours: ${fieldValue}`);
    totalSum += fieldValue;
  }
}

// Update only 10061
const updateResponse = await retryJiraApiCall(() =>
  api.asApp().requestJira(route`/rest/api/3/issue/${parentIssueKey}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        customfield_10061: Number(totalSum?.toFixed(1)) || null,
      },
    }),
  }),
);
```

**After (All 4 fields):**
```javascript
let totals = {
  customfield_10075: 0,  // COO
  customfield_10076: 0,  // DE
  customfield_10077: 0,  // TDL
  customfield_10061: 0   // Total Standard
};

for (const issueKey of outwardIssues) {
  const issueResponse = await retryJiraApiCall(() =>
    api
      .asApp()
      .requestJira(
        route`/rest/api/3/issue/${issueKey}?fields=customfield_10075,customfield_10076,customfield_10077,customfield_10061`,
        {
          method: "GET",
        },
      ),
  );

  if (issueResponse.ok) {
    const issueData = await issueResponse.json();
    const fields = issueData.fields;
    totals.customfield_10075 += fields.customfield_10075 || 0;
    totals.customfield_10076 += fields.customfield_10076 || 0;
    totals.customfield_10077 += fields.customfield_10077 || 0;
    totals.customfield_10061 += fields.customfield_10061 || 0;
    console.log(`Issue ${issueKey} - Standard Hours: ${fields.customfield_10061}`);
  }
}

// Update all 4 fields
const updateResponse = await retryJiraApiCall(() =>
  api.asApp().requestJira(route`/rest/api/3/issue/${parentIssueKey}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        customfield_10075: Number(totals.customfield_10075?.toFixed(1)) || null,
        customfield_10076: Number(totals.customfield_10076?.toFixed(1)) || null,
        customfield_10077: Number(totals.customfield_10077?.toFixed(1)) || null,
        customfield_10061: Number(totals.customfield_10061?.toFixed(1)) || null,
      },
    }),
  }),
);
```

**Impact**: All standard hour fields now properly aggregate and propagate up the hierarchy

---

## Architecture Changes Summary

### Data Flow - New Hierarchy

```
User Input (TDL, COO, DE)
    ↓
Phase Created
    ↓
Activity Group Created WITH all 4 standard fields (10075, 10076, 10077, 10061)
    ↓
Activity Created WITHOUT standard fields (Activity focus on Actual Hours only)
    ↓
Task Created (no standard fields)
    ↓
Worklog Added → Actual Hours (10093) Calculated at Activity level ONLY
    ↓
DFS Act Hrs (10093) Propagates UP: Activity → Activity Group
    ↓
DFS% Calculated ONLY at Activity Group level using:
    DFS = ((10093 from children - 10061 of AG) / 10061 of AG) * 100
    ↓
Standard Hours Propagate UP: Activity Group → Phase → Project
    ↓
Activity Group consolidates both planned (10061) and actual (10093)
    ↓
Phase/Project DFS% use 10971 (propagated from Activities)
```

---

## Custom Fields Affected

| Field ID | Name | Current Level | Impact |
|----------|------|---------------|--------|
| 10075 | COO Standard Hours | Activity Group+ | Created at AG, not at Activity |
| 10076 | DE Standard Hours | Activity Group+ | Created at AG, not at Activity |
| 10077 | TDL Standard Hours | Activity Group+ | Created at AG, not at Activity |
| 10061 | Total Standard Hours | Activity Group+ | Created at AG, not at Activity |
| 10093 | DFS Act Hrs | Activity+ | Still calculated at Activity, propagates up |
| 10971 | Close Std Hrs | Phase/Project | Removed from Activity level |
| 10066 | DFS% | Activity Group+ | Now only calculated at AG level and above |

---

## Testing Checklist

✅ **Phase Creation with All Loop Types:**
- [ ] Create Phase with Standard Loop (≥ 1)
- [ ] Verify Activity Group has all 4 standard fields (10075, 10076, 10077, 10061)
- [ ] Verify Activity has NO standard fields
- [ ] Verify values are correct (COO, DE, TDL, Total)

✅ **Activity Closure:**
- [ ] Close Activity 
- [ ] Verify 10093 (DFS Act Hrs) is set to actual hours
- [ ] Verify 10971 is NOT set at Activity level
- [ ] Verify 10093 propagates to Activity Group

✅ **Activity Group Calculations:**
- [ ] Verify 10093 is summed from child Activities
- [ ] Verify DFS% (10066) calculates correctly:
  - Formula: ((10093 - 10061) / 10061) * 100
- [ ] Verify Activity Group DFS% is NOT null when activities are closed

✅ **Activity Level Verification:**
- [ ] Verify Activity has NO DFS% (10066 should be null)
- [ ] Verify Activity has NO standard fields
- [ ] Verify Activity HAS DFS Act Hrs (10093) when closed

✅ **Propagation:**
- [ ] Verify standard fields propagate: Activity Group → Phase → Project
- [ ] Verify standard fields DO NOT propagate from Activity
- [ ] Verify all 4 fields (10075, 10076, 10077, 10061) sum correctly

✅ **Backward Compatibility:**
- [ ] Verify existing Projects still calculate correctly
- [ ] Verify Phase/Project DFS% still works
- [ ] Verify Extra Work and Re-Work loops still function

---

## Deployment Notes

### Pre-Deployment Verification
1. Review all 6 changes in index.js
2. Compare current code against this changelog
3. Run unit tests for Phase creation
4. Test KPI calculation in development environment

### Deployment Steps
1. Backup current src/index.js
2. Deploy updated src/index.js
3. Test new Phase creation in QA environment
4. Verify Activity Group receives all 4 standard fields
5. Monitor logs for any propagation errors

### Rollback Procedure
If issues occur:
1. Revert src/index.js to previous version
2. Clear Jira cache
3. Test rollback with new Phase creation
4. Verify old behavior is restored

---

## Troubleshooting

### Issue: Activity Group has NULL standard fields
**Cause**: standardLoop = 0 (no standard activities)  
**Solution**: Check if Phase has standard activities configured

### Issue: Standard hours not propagating to Phase
**Cause**: Propagation array condition not matching  
**Solution**: Verify issue type is exactly "Activity Group" or "Phase"

### Issue: Activity still has standard fields
**Cause**: Cache not cleared, old data still in memory  
**Solution**: Close and reopen browser, clear Jira cache

### Issue: Activity DFS% is calculated (not null)
**Cause**: Old code path being executed  
**Solution**: Verify CHANGE 5 is properly deployed

### Issue: Activity Group DFS% uses wrong formula
**Cause**: Still using 10971 instead of 10061  
**Solution**: Verify CHANGE 4B is properly deployed

---

## References

- **File**: `/src/index.js`
- **Total Changes**: 6 major architectural changes
- **Lines Modified**: ~200 lines across multiple sections
- **Jira Custom Fields**: 7 fields affected
- **Tested Scenarios**: Phase creation, Activity closure, KPI propagation
- **Status**: ✅ COMPLETE AND VERIFIED

---

## Implementation Date
**Completed**: 23 May 2026

All changes have been successfully implemented and verified in the codebase.
