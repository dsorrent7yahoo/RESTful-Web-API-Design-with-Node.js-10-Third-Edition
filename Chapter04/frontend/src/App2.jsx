//Standard imports React, useMemo, useState from 'react'
import React,  {useEffect, useMemo, useState } from 'react';

//setup const API_OPTions = [

//id: get[All, ById, *], label: 'GET /controller/ , method: '[GET|POST|PUT|DELETE], path: '/catalog/', needsBody: [true,false], needsItemId: [true|false], needsCategory: [t|f]},
const API_OPTIONS = [
  { id: 'getAll', label: 'GET /catalog/', method: 'GET', path: '/catalog/', needsBody: false, needsItemId: false, needsCategory: false },
  { id: 'getById', label: 'GET /catalog/item/:itemId', method: 'GET', path: '/catalog/item/{itemId}', needsBody: false, needsItemId: true, needsCategory: false },
  { id: 'getByCategory', label: 'GET /catalog/:categoryId', method: 'GET', path: '/catalog/{categoryId}', needsBody: false, needsItemId: false, needsCategory: true },
  { id: 'postItem', label: 'POST /catalog/', method: 'POST', path: '/catalog/', needsBody: true, needsItemId: false, needsCategory: false },
  { id: 'putItem', label: 'PUT /catalog/', method: 'PUT', path: '/catalog/', needsBody: true, needsItemId: false, needsCategory: false },
  { id: 'deleteById', label: 'DELETE /catalog/item/:itemId', method: 'DELETE', path: '/catalog/item/{itemId}', needsBody: false, needsItemId: true, needsCategory: false }
];

//Setup default body that can be used in forms and tables

const DEFAULT_BODY = {
  itemId: '11',
  itemName: 'Trail Camera',
  price: 220,
  currency: 'USD',
  categories: ['Electronics', 'Outdoor']
};

//setup function to pretty print JSON using JSON.stringify

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

/*
look at the data and the api that you need to interface with first
*/

export default function App() {
  //declare app founctionality with state and setters
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000');
  const [baseUrl2, setBaseUrl2] = useState('http://localhost:3000');

  const [selectedId, setSelectedId] = useState('getAll');
  const [selectId2, setSelectId2] = useState('getAll');

  const [itemId, setItemId] = useState('1');
  const [itemId2, setItemId2] = useState('1'); 

  const [itemOptions, setItemOptions] = useState([]);
  const [itemOptions2, setItemOptions2] = useState([]);

  const [categoryOptions, setCategoryOptions] = useState([]);
  const [categoryOptions2, setCategorOptions2] = useState([]);

  const [categoryId, setCategoryId] = useState('Watches');
  const [categoryId2, setCategoryId2] = useState('Watches'); 

  const [bodyText, setBodyText] = useState(prettyJson(DEFAULT_BODY));
  const [bodyText2, setBodyText2] = useState(prettyJson(DEFALT_BODY));

  const [result, setResult] = useState('Run a request to see results here.');
  const [result2, setResult2] = useState('Run a request to see results here.');

  const [status, setStatus] = useState('');
  const [status2, setStatus2] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isLoading2, setIsLoading2] = useState(false);

  const [showResponseModal, setShowResponseModal] = useState(false);
  const [showResponseModal2, setShowResponseModal2] = useState(false);

  const [tableRows, setTableRows] = useState([]);  //list-array
  const [tableRows2, setTableRows2] = useState([]);

function normalizeRowsFromResponse(payload) {
    //Build a table of more than one row
    if(Array.isArray(payload)) {
        return payload.filter((row) => row && typeof row === 'object');
    }
    //one row
    if(paylo9ad && typeof payload === 'object') {
        return [payload];
    }

    return []; //empty list if neither

  /*
public static List<Map<String, Object>> normalizeRowsFromResponse(Object payload) {
        if (payload instanceof List<?>) {
        if(payload instanceof List<?>)) {
            List<?> rawList = (List<?>) payload
            List<?> rawList = (List<?>) payload; !!!!!!!!!!!
            List<Map<String, Object>> rows = new ArrayList<>();
            List<Map<String, Object>> rows = new ArrayList<>();

            for (Object row : rawList) {
                if (row instanceof Map<?, ?>) {
                    rows.add((Map<String, Object>) row);
                }
            }
            for(Object row : rawlist) {
                if (row instanceof Map<?,?>) {
                    rows.add(Map<String, Object>) row);
            }}
            return rows;
        }

        if (payload instanceof Map<?, ?>) {
            return Collections.singletonList((Map<String, Object>) payload);
        }

        return Collections.emptyList();
    }
  */


}

async function loadOptions(currentBaseUrl) {
    try {
        const normalizeBase = currentBaseUrl.trim().replace(/\/$/, '');
        //const newbase = normalizeBase.lastIndexOf('/').replace('');
        const itemsResponse = await fetch(`${normalizeBase}/catalog/`);
        if(!response.ok) {
            return;
        }
        const data = await response.json();
        if(!Array.isArray(data)) {
            return;
        }

        //options for pull down menu should display item.id and item name
        const options = data
        // filtr (predicate) value    index
            .filter((item) => item && item.itemId)
            .map((item) => ({ //foreach item build a table of itemId and label
            value: String(item.itemId),
            label: `${item.itemId} - ${item.itemName || 'Unnamed Item'}`
            }));
        
             //list unique categories in Set
        const categories = Array.from(
            new Set(
                data  //build a list of categories from each item
                .flatMap((item) => (Array.isArray(item.categories) ? 
                    item.categories : [])) //else empty list
                .filter((category) => Boolean(category)) //eliminates falsy
            )
            ).sort((a, b) => a.localeCompare(b));
        
        setItemOptions(options);
        setCategoryOptions(categories);

        if(options.length === 0) {  //everything is a reference need ===
            setItemId('');
        } else if (!options.some((option))) => option.value === itemId)){
            setItemId(options[0].value);
        }

        if(categories.length ===0) {
            setCategoryId('');

        }else if(!categories.includes(categoryId)){
            setCategoryId(catagories[0]);
        }
    }catch(error) {{
        console.error('Error loading options:', error);
    }}   
}

const selected = useMemo( 
() => API_OPTIONS.find((option) => option.id === selectedId) || 
    API_OPTIONS[0], [selectedId]
    //selected = option.id === selectedId ? selectedId ? API_OPTION[0]
);


useEffect(() => {  //called when page is loaded into browser
loadOptions(baseUrl);
}, [baseUrl]);

function restrtExplorer() {
    setBaseUrl('http://localhost:3000');
    setSelectedId('getAll');
    setItemId('1');
    setCategoryId(categoryOptions[0] || 'Watches'); //null
    setBodyText(prettyJson(DEFAULT_BODY));
    setResult('Run a request to see results here: ');
    setStatus('Explorer reset');
}

function quitExplorer() {
    window.close();
    setStatus('Quit requested');
    setResult('If the tab did not close (browser policy), you can close it manually.');
}

const resolvPath = useMemo(() => { //functiont to manage cache
    if(selected.needsItemId) {
    //  return selected.path.replace('{searchvalue}', encodedURIComponent(searchValue.trim()));
          return selected.path.replace('{itemId}', encodeURIComponent(itemId.trim()));
        
    }
    if (selected.needsCategory) { //*categoryId
      return selected.path.replace('{categoryId}', encodeURIComponent(categoryId.trim()));
    }
    return selected.path;
}

 async function runRequest(event) {
    event.preventDefault();

    if (selected.needsItemId && !itemId.trim()) {
      setStatus('Item ID is required.');
      return;
    }

    if (selected.needsCategory && !categoryId.trim()) {
      setStatus('Category is required.');
      return;
    }

    const normalizedBase = baseUrl.trim().replace(/\/$/, '');
    const url = normalizedBase + resolvedPath;
    const options = { method: selected.method, headers: {} };

    if (selected.needsBody) {
      try {
        const parsed = JSON.parse(bodyText);
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(parsed);
      } catch (error) {
        setStatus('Invalid JSON body. Fix it and try again.');
        return;
      }
    }

    setIsLoading(true);
    setStatus('Sending request...');

    try {
      //cool first get the response then get the response.text lazy loading
      const response = await fetch(url, options);
      const responseText = await response.text();


      let parsedBody = responseText;

      try {
        parsedBody = JSON.parse(responseText);
      } catch (error) {
      }
    //resolve response.status and response.statusText

      setStatus(`${response.status} ${response.statusText}`);
      setResult(prettyJson(parsedBody));
    //now setup result in table format

      const rows = normalizeRowsFromResponse(parsedBody);
      if (rows.length > 0) {
        setTableRows(rows);
        setShowResponseModal(true);
      }

      if (selected.method === 'POST' || selected.method === 'PUT' 
        || selected.method === 'DELETE') {
        loadOptions(baseUrl);
      }
    } catch (error) {
      setStatus('Request failed');
      setResult(error.message || String(error));
    } finally {
      setIsLoading(false);
    }
  }






















