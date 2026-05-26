import React, { useState, useEffect } from 'react';
import Button from '@atlaskit/button';
import TextField from '@atlaskit/textfield';
import Checkbox from '@atlaskit/checkbox';
import styled from 'styled-components';
import { view, invoke } from '@forge/bridge'; // Forge API for modal interaction
import pako from 'pako';

// Fallback data
const fallbackData = {};

const nonProductPartKeys = ['extraWorkLoop', 'reWorkLoop', 'standardLoop', 'checked', 'order', 'componentSelected', 'noOfComponent'];

// Styled Components
const Container = styled.div`
  padding: 40px;
  margin: 20px;
  background-color: #f4f5f7;
  border-radius: 12px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  min-height: 100vh;
  box-sizing: border-box;
`;

const Header = styled.h2`
  margin-bottom: 24px;
  color: #172b4d;
  font-size: 24px;
  font-weight: 600;
`;

const TabContainer = styled.div`
  display: flex;
  margin-bottom: 20px;
  border-bottom: 2px solid #dfe1e6;
`;

const Tab = styled.button`
  padding: 12px 24px;
  border: none;
  background: ${props => props.active ? '#0052cc' : 'transparent'};
  color: ${props => props.active ? 'white' : '#5e6c84'};
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  font-weight: 600;
  margin-right: 8px;
  transition: all 0.2s;

  &:hover {
    background: ${props => props.active ? '#0052cc' : '#f4f5f7'};
  }
`;

const SaveButton = styled(Button)`
  margin-bottom: 20px !important;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  padding: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  background-color: white;
  border-radius: 8px;
  overflow: hidden;
`;

const Th = styled.th`
  text-align: left;
  background: #ebecf0;
  color: #253858;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid #dfe1e6;
  vertical-align: middle;
`;

const Td = styled.td`
  padding: 12px 16px;
  font-size: 14px;
  border-bottom: 1px solid #f0f0f0;
  vertical-align: middle;
`;

const TdFirst = styled.td`
  padding: 12px 16px;
  font-size: 14px;
  border-bottom: 1px solid #f0f0f0;
  font-weight: 500;
  color: #172b4d;
  vertical-align: middle;
`;

const Tr = styled.tr`
  &:hover {
    background-color: #f9fafc;
  }
`;

const Indent = styled.span`
  padding-left: 40px;
  display: inline-block;
  color: #5e6c84;
`;

const StyledTextField = styled(TextField)`
  input {
    border-radius: 6px !important;
    height: 36px !important;
    text-align: center !important;
    width: 100px !important;
  }
`;

const CheckboxContainer = styled.div`
  display: flex;
  align-items: center;
`;

const StyledCheckbox = styled(Checkbox)`
  margin-right: 8px;
`;

const App = () => {
  const [activeTab, setActiveTab] = useState('protoserie');
  const [data, setData] = useState({});
  const [error, setError] = useState(null);
  const [json, setJson] = useState({activities: {}});

  useEffect(() => {
    console.log(json, data);
    if (json && json.activities) {
      setData(json.activities);
    }
  }, [json]);

  useEffect(() => {
    loadAllValues();
    console.log("loaded");
  }, []);

  const loadAllValues = async () => {
    const context = await view.getContext();
    const issue = context.extension.issue; // context.issue may contain { key: 'ABC-123', ... }
    console.log(issue)
    const fetchActivities = async () => {
      const base64String = await invoke("getQuotationData", { issue });
      if (base64String) {
        const uint8Arr = base64ToUint8Array(base64String);
        const decompressedString = pako.inflate(uint8Arr, { to: 'string' });
        const parsedData = JSON.parse(decompressedString);
        console.log(parsedData)
        setJson(parsedData);
      }
    };
    await fetchActivities();
    // setCreated(false)
    // if (issue && issue.key) {
    //   setIssueKey(issue.key);
    //   // Once we have issueKey, fetch data from storage
    //   const base64String = await invoke('getData', { issueKey: issue.key, phase });
    //   if (base64String) {
    //     const uint8Arr = base64ToUint8Array(base64String);
    //     const decompressedString = pako.inflate(uint8Arr, { to: 'string' });
    //     const parsedData = JSON.parse(decompressedString);

    //     setPhaseName(parsedData.phaseName);
    //     // setExtraWork(parsedData.extraWork);
    //     setMilestones(parsedData.milestones);
    //     setActivities(parsedData.activities);
    //     setTotalHours(parsedData.totalHours);
    //     setCreated(true)
    //   }
    // }
  };

  function uint8ArrayToBase64(uint8Arr) {
    let CHUNK_SIZE = 0x8000;
    let chunks = [];
    for (let i = 0; i < uint8Arr.length; i += CHUNK_SIZE) {
      chunks.push(String.fromCharCode.apply(null, uint8Arr.subarray(i, i + CHUNK_SIZE)));
    }
    const binaryString = chunks.join('');
    return btoa(binaryString);
  }

  function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (!json.activities) {
          setError('Invalid JSON: Missing "activities" key.');
          return;
        }
        setError(null);
        setData(json.activities);
        setJson(json);
      } catch (err) {
        setError('Error parsing JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const handleProtoSerieChange = (activityKey, subKey, field, value) => {
    const updated = { ...data };
    const numericValue = parseInt(value || 0);

    Object.entries(updated[activityKey]).forEach(([partKey, partData]) => {
      if (!nonProductPartKeys.includes(partKey)) {
        if (subKey) {
          if (partData?.subactivity?.[subKey]) {
            partData.subactivity[subKey][field] = numericValue;
          }
        } else {
          if (partData?.hasOwnProperty(field)) {
            partData[field] = numericValue;
          }
        }
      }
    });

    setData(updated);
  };

  const handleCheckboxChange = (activityKey) => {
    const updated = { ...data };
    updated[activityKey].checked = !updated[activityKey].checked;
    setData(updated);
  };

  const handleRoofTypeCheckboxChange = (roofType) => {
    const updated = { ...data };
    
    // Update componentSelected for this roof type across all activities
    Object.entries(updated).forEach(([activityKey, activity]) => {
      if (activity[roofType]) {
        activity[roofType].componentSelected = !activity[roofType].componentSelected;
      }
    });
    
    setData(updated);
  };

  const handleRoofTypeQuantityChange = (roofType, value) => {
    const updated = { ...data };
    const numericValue = parseInt(value || 0);
    
    // Update noOfComponent for this roof type across all activities
    Object.entries(updated).forEach(([activityKey, activity]) => {
      if (activity[roofType]) {
        activity[roofType].noOfComponent = numericValue;
      }
    });
    
    setData(updated);
  };

  const handleSave = async () => {
    // const blob = new Blob([JSON.stringify({ activities: data ,id:json.id,name:json.name}, null, 2)], {
    //   type: 'application/json',
    // });
    // const url = URL.createObjectURL(blob);
    // const a = document.createElement('a');
    // a.href = url;
    // a.download = 'updated_activities.json';
    // a.click();
    // URL.revokeObjectURL(url);
    const context = await view.getContext();
    const issue = context.extension.issue.key; 
    console.log(data)
    let payload={ activities: data, id: json.id, name: json.name }
    const jsonString = JSON.stringify(payload);
    const compressedData = pako.deflate(jsonString);
    const base64String = uint8ArrayToBase64(compressedData);
    await invoke("saveQuotationData", { issue , data: base64String});
    console.log("quotation saved")
    
    // Show selected roof types
    const selectedRoofTypes = [];
    const allRoofTypes = new Set();
    
    // Get all unique roof types
    Object.values(data).forEach(activity => {
      Object.keys(activity).forEach(key => {
        if (!nonProductPartKeys.includes(key)) {
          allRoofTypes.add(key);
        }
      });
    });
    
    // Check which roof types are selected and have quantities
    Array.from(allRoofTypes).forEach(roofType => {
      const firstActivity = Object.values(data).find(activity => activity[roofType]);
      if (firstActivity && firstActivity[roofType].componentSelected && firstActivity[roofType].noOfComponent > 0) {
        selectedRoofTypes.push(`${roofType}: ${firstActivity[roofType].noOfComponent}`);
      }
    });
    
    if (selectedRoofTypes.length > 0) {
      alert(`Data saved successfully!\n\nSelected Roof Types (applies to all activities):\n${selectedRoofTypes.join('\n')}`);
    } else {
      alert('Data saved successfully!');
    }
  };

  const renderProtoSerieTable = () => {
    const rows = [];

    // Sort activities by order
    const sortedActivities = Object.entries(data).sort(([, activityA], [, activityB]) => {
      const orderA = parseInt(activityA.order) || 0;
      const orderB = parseInt(activityB.order) || 0;
      return orderA - orderB;
    });

    sortedActivities.forEach(([activityKey, activity]) => {
      const samplePartEntry = Object.entries(activity).find(
        ([key]) => !nonProductPartKeys.includes(key)
      );

      if (!samplePartEntry) return;

      const [, partData] = samplePartEntry;
      const hasSub = partData.subactivity && Object.keys(partData.subactivity).length > 0;

      rows.push(
        <Tr key={`${activityKey}`}>
          <TdFirst>
            <CheckboxContainer>
              <StyledCheckbox
                isChecked={activity.checked || false}
                onChange={() => handleCheckboxChange(activityKey)}
                label=""
              />
              {activityKey}
            </CheckboxContainer>
          </TdFirst>
          <Td>
            {!hasSub && (
              <StyledTextField
                type="number"
                value={partData.Proto || 0}
                onChange={(e) => handleProtoSerieChange(activityKey, null, 'Proto', e.target.value)}
              />
            )}
          </Td>
          <Td>
            {!hasSub && (
              <StyledTextField
                type="number"
                value={partData.Serie || 0}
                onChange={(e) => handleProtoSerieChange(activityKey, null, 'Serie', e.target.value)}
              />
            )}
          </Td>
        </Tr>
      );

      if (hasSub) {
        // Sort subactivities by order too
        const sortedSubactivities = Object.entries(partData.subactivity).sort(([, subA], [, subB]) => {
          const orderA = parseInt(subA.order) || 0;
          const orderB = parseInt(subB.order) || 0;
          return orderA - orderB;
        });

        sortedSubactivities.forEach(([subKey, sub]) => {
          rows.push(
            <Tr key={`${activityKey}-${subKey}`}>
              <Td>
                <Indent>└─ {subKey}</Indent>
              </Td>
              <Td>
                <StyledTextField
                  type="number"
                  value={sub.Proto || 0}
                  onChange={(e) => handleProtoSerieChange(activityKey, subKey, 'Proto', e.target.value)}
                />
              </Td>
              <Td>
                <StyledTextField
                  type="number"
                  value={sub.Serie || 0}
                  onChange={(e) => handleProtoSerieChange(activityKey, subKey, 'Serie', e.target.value)}
                />
              </Td>
            </Tr>
          );
        });
      }
    });

    return rows;
  };

  const renderComponentSelectionTable = () => {
    const rows = [];

    // Get unique roof types from all activities
    const allRoofTypes = new Set();
    Object.values(data).forEach(activity => {
      Object.keys(activity).forEach(key => {
        if (!nonProductPartKeys.includes(key)) {
          allRoofTypes.add(key);
        }
      });
    });

    // Create rows for each unique roof type
    Array.from(allRoofTypes).sort().forEach(roofType => {
      // Get the first activity that has this roof type to read the values
      const firstActivity = Object.values(data).find(activity => activity[roofType]);
      const roofData = firstActivity ? firstActivity[roofType] : {};

      rows.push(
        <Tr key={roofType}>
          <TdFirst>
            <CheckboxContainer>
              <StyledCheckbox
                isChecked={roofData.componentSelected || false}
                onChange={() => handleRoofTypeCheckboxChange(roofType)}
                label=""
              />
              {roofType}
            </CheckboxContainer>
          </TdFirst>
          <Td>
            <StyledTextField
              type="number"
              min="0"
              placeholder="0"
              value={roofData.noOfComponent || ''}
              onChange={(e) => handleRoofTypeQuantityChange(roofType, e.target.value)}
            />
          </Td>
        </Tr>
      );
    });

    return rows;
  };

  return (
    <Container>
      {error && <div style={{ color: 'red', marginBottom: '16px' }}>{error}</div>}
      
      <TabContainer>
        <Tab 
          active={activeTab === 'selection'}
          onClick={() => setActiveTab('selection')}
        >
          Component Selection
        </Tab>
        <Tab 
          active={activeTab === 'protoserie'}
          onClick={() => setActiveTab('protoserie')}
        >
          Proto & Serie Loops
        </Tab>
      </TabContainer>

      <SaveButton appearance="primary" onClick={handleSave}>
        Save Changes
      </SaveButton>

      {/* File Upload Input - Commented for production */}
      {/* <div style={{ marginBottom: '16px' }}>
        <input
          type="file"
          accept=".json,application/json"
          onChange={handleFileUpload}
          style={{ marginRight: '12px' }}
        />
        {error && <span style={{ color: 'red' }}>{error}</span>}
      </div> */}

      {activeTab === 'selection' && (
        <Table>
          <thead>
            <tr>
              <Th>Roof Type</Th>
              <Th>Number</Th>
            </tr>
          </thead>
          <tbody>{renderComponentSelectionTable()}</tbody>
        </Table>
      )}

      {activeTab === 'protoserie' && (
        <Table>
          <thead>
            <tr>
              <Th>Activity</Th>
              <Th>Proto</Th>
              <Th>Serie</Th>
            </tr>
          </thead>
          <tbody>{renderProtoSerieTable()}</tbody>
        </Table>
      )}
    </Container>
  );
};

export default App;