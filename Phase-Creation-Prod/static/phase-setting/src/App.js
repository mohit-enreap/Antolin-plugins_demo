import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import styled from 'styled-components';
import Button from '@atlaskit/button';
import Textfield from '@atlaskit/textfield';
import ModalDialog, { ModalTransition } from '@atlaskit/modal-dialog';
import Editor from 'react-simple-code-editor';
import { highlight, languages } from 'prismjs';
import 'prismjs/components/prism-json'; // JSON syntax highlighting
import 'prismjs/themes/prism.css'; // Default Prism theme
import pako from 'pako';




const Container = styled.div`
  display: flex;
  height: 100vh;
  font-family: Arial, sans-serif;
`;

const Sidebar = styled.div`
  width: 220px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-right: 1px solid #ddd;
`;

const Content = styled.div`
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  position: relative;
`;

const EditorWrapper = styled.div`
  margin-top: 16px;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: #fff;
`;

const TopRightButtons = styled.div`
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
`;

const ValidationMessage = styled.div`
  margin-top: 8px;
  font-size: 14px;
  color: ${(props) => (props.isValid ? 'green' : 'red')};
`;

const ModalContent = styled.div`
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
`;

const App = () => {
  const [data, setData] = useState({});
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [editorValue, setEditorValue] = useState('');
  const [isJSONValid, setIsJSONValid] = useState(true);
  const [validationError, setValidationError] = useState('');
  const [isModalOpen, setModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');

  function uint8ArrayToBase64(uint8Arr) {
    let CHUNK_SIZE = 0x8000; // To avoid "maximum call stack size exceeded" for large data
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
  

  // Fetch product data from Forge Storage
  useEffect(() => {
    const fetchData = async () => {
      const base64String = await invoke('getProductData');
      if (base64String) {
        const uint8Arr = base64ToUint8Array(base64String);
        const decompressedString = pako.inflate(uint8Arr, { to: 'string' });
        const productData = JSON.parse(decompressedString);
        console.log(productData)
        setData(productData);
      }
    };
    fetchData();
  }, []);

  const handleEditorChange = (value) => {
    setEditorValue(value);

    try {
      JSON.parse(value);
      setIsJSONValid(true);
      setValidationError('');
    } catch (error) {
      setIsJSONValid(false);

      // Extract line and column numbers from error
      const positionMatch = error.message.match(/at position (\d+)/);
      if (positionMatch) {
        const position = parseInt(positionMatch[1], 10);
        const lines = value.substring(0, position).split('\n');
        const lineNumber = lines.length;
        const columnNumber = lines[lines.length - 1].length + 1;
        setValidationError(`Error at line ${lineNumber}, column ${columnNumber}: ${error.message}`);
      } else {
        setValidationError(error.message);
      }
    }
  };

  const formatJSON = (json) => JSON.stringify(json, null, 2);

  const updateProduct = async () => {
    if (!isJSONValid) {
      alert('Cannot update: Invalid JSON format.');
      return;
    }

    const parsedData = JSON.parse(editorValue);
    const oldKey = selectedProduct;
    const newKey = parsedData.name.trim();

    if (!newKey) {
      alert('Product name cannot be empty.');
      return;
    }

    if (newKey !== oldKey && data[newKey]) {
      alert('Product with this name already exists.');
      return;
    }

    // Rename the key in the data object
    const updatedData = { ...data };
    delete updatedData[oldKey];
    updatedData[newKey] = parsedData;
    const jsonString = JSON.stringify(updatedData);
    const compressedData = pako.deflate(jsonString);
    const base64String = uint8ArrayToBase64(compressedData);
    console.log("data",base64String)
    await invoke('updateProductData', { updatedData:base64String });
    setData(updatedData);
    setSelectedProduct(newKey);
    setEditorValue(formatJSON(parsedData));
    alert('Product updated successfully!');
  };

  const deleteProduct = async () => {
    const updatedData = { ...data };
    delete updatedData[selectedProduct];

    const jsonString = JSON.stringify(updatedData);
    const compressedData = pako.deflate(jsonString);
    const base64String = uint8ArrayToBase64(compressedData);
    console.log("data",base64String)

    await invoke('updateProductData', { updatedData:base64String });
    setData(updatedData);
    setSelectedProduct(null);
    setEditorValue('');
    alert('Product deleted successfully!');
  };

  const addProduct = async () => {
    const newKey = newProductName.trim();

    if (!newKey) {
      alert('Product name cannot be empty.');
      return;
    }

    if (data[newKey]) {
      alert('Product with this name already exists.');
      return;
    }

    const newProduct = { id: Object.keys(data).length + 1, name: newKey };
    const updatedData = { ...data, [newKey]: newProduct };

    const jsonString = JSON.stringify(updatedData);
    const compressedData = pako.deflate(jsonString);
    const base64String = uint8ArrayToBase64(compressedData);
    console.log("data",base64String)

    await invoke('updateProductData', { updatedData:base64String });
    setData(updatedData);
    setNewProductName('');
    setModalOpen(false);
  };

  return (
    <Container>
      {/* Sidebar */}
      <Sidebar>
        <h3>Products</h3>
        {Object.keys(data).map((key) => (
          <Button
            key={key}
            onClick={() => {
              setSelectedProduct(key);
              setEditorValue(formatJSON(data[key]));
            }}
            appearance={selectedProduct === key ? 'primary' : 'default'}
          >
            {data[key].name}
          </Button>
        ))}
        <Button onClick={() => setModalOpen(true)} appearance="subtle-link">
          + Add Product
        </Button>
      </Sidebar>

      {/* Main Content */}
      <Content>
        {selectedProduct ? (
          <>
            <TopRightButtons>
              <Button onClick={updateProduct} appearance="primary">
                Update
              </Button>
              <Button onClick={deleteProduct} appearance="danger">
                Delete
              </Button>
            </TopRightButtons>
            <h3>Editing: {selectedProduct}</h3>
            <EditorWrapper>
              <Editor
                value={editorValue}
                onValueChange={handleEditorChange}
                highlight={(code) => highlight(code, languages.json, 'json')}
                padding={10}
                style={{
                  fontFamily: '"Courier New", monospace',
                  fontSize: 14,
                }}
              />
            </EditorWrapper>
            {validationError ? (
              <ValidationMessage isValid={false}>{validationError}</ValidationMessage>
            ) : (
                <ValidationMessage isValid={true}>Valid JSON</ValidationMessage>
              )}
          </>
        ) : (
            <p>Select a product to edit</p>
          )}
      </Content>

      {/* Modal for Adding New Product */}
      <ModalTransition>
        {isModalOpen && (
          <ModalDialog
            onClose={() => setModalOpen(false)}
            heading="Add New Product"
          >
            <ModalContent>
              <Textfield
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
                placeholder="Enter Product Name"
              />
              <ModalFooter>
                <Button onClick={addProduct} appearance="primary">
                  Add
                </Button>
                <Button onClick={() => setModalOpen(false)} appearance="subtle">
                  Cancel
                </Button>
              </ModalFooter>
            </ModalContent>
          </ModalDialog>
        )}
      </ModalTransition>
    </Container>
  );
};

export default App;
