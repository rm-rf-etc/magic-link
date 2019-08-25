import { createElement, useRef, useState, useEffect, useCallback } from 'react';
import _intrnl, { symbolString } from './internal';
import advancedTypes from './advancedTypes';
// const { isArray } = Array;

const bind = (
	{ index, methods, schema },
	Component,
) => {
	/*
	Validation block. All invalid input should throw.
	*/
	if (typeof Component !== 'function') {
		throw new Error(`\`bind\` expects a React component, but received ${typeof Component} instead.`);
	}
	if (!schema || !schema.constructor || schema.constructor.name !== 'Object') {
		throw new Error('`bind` could not find a valid schema');
	}

	/*
	Convert from developer-friendly syntax to internally-useful schema structure
	*/
	schema = Object.entries(schema).reduce((sum, [key, [type, _default, options]]) => ({
		...sum,
		[key]: { type, default: _default, options },
	}), {});

	let initialState = {};
	// console.log('bind:', index);

	return (ownProps) => {
		const methodsRef = useRef();
		const stateRef = useRef(initialState);

		/*
		Because we only process methods once, we have to provide a means to get the current
		state within those methods. `getState` will return the most recent state object, generated
		from the reducer. `getState` expects a prop
		*/
		const getState = useCallback((propKey) => {
			const state = stateRef.current;

			if (!schema.hasOwnProperty(propKey)) {
				throw new Error(`Property '${propKey}' not available from your pre-defined schema`);
			}

			const statePiece = state[propKey];
			const type = schema[propKey] ? schema[propKey].type : null;

			return type && advancedTypes[type] ? advancedTypes[type].retrieve(statePiece) : statePiece;
		}, []);

		const [state, setState] = useState(stateRef.current || initialState);
		stateRef.current = state;


		/*
		One-time setup process. Adds node property listeners and sets default node property values.
		*/
		useEffect(() => {

			if (typeof _intrnl !== 'object' || !_intrnl.indices) {
				throw new Error('Indices not initialized');
			}
			if ((index.id && typeof index.id !== 'string') || !Object.values(_intrnl.indices).includes(index)) {
				throw new Error('Invalid index');
			}

			Object.entries(schema).forEach(([key, { default: _default, type, options }]) => {
				const typeConverter = advancedTypes[type];
				if (typeConverter.multiIndex) {
					typeConverter.init(_default, { base: key, axes: options });
				} else {
					initialState[key] = typeConverter ? typeConverter.store(_default) : _default;
				}
			});


			/*
			For the current property, load the associated developer-provided schema.
			Using this schema, check if it's a special type, and if so, use that
			special type to `put` the default value.
			*/
			const listeners = {};

			Object.keys(schema).forEach((propKey) => {

				// a gun db reference for this property of our active node
				const nodeProp = node.get(propKey);

				nodeProp.once((value) => {

					if (initialState[propKey]) {
						nodeProp.put(value || initialState[propKey]);
					}
				});

				nodeProp.on((propVal, propKey, _, chain) => {

					// store chain object so we can remove listeners upon unmount
					if (!listeners[propKey]) listeners[propKey] = chain;

					setState({ [propKey]: propVal });
				});
			});

			return () => Object.entries(listeners).forEach(([propKey, chain]) => {
				chain.off();
				delete listeners[propKey];
			});

		}, []);


		/*
		If index is an object with property `id`, then node lookup needs to happen
		from above the application root, because gun ID's are global.

		gun.get('jsdk24ys')
		vs
		gun.get('app_root').get('node_name')
		*/
		const lookupStr = index.id || symbolString(index);
		const node = (index.id ? _intrnl.gun : _intrnl.app).get(lookupStr);


		/*
		Methods from our developer should be processed only once. But this needs to
		be synchronous and happen before render, so we can't do this in useEffect.
		*/
		if (!methodsRef.current) {

			const defaultMethods = {
				get: node.get,
				put: (propKey, val) => {
					const advancedType = getSpecial(propKey, schema);

					if (advancedType && !advancedType.multiIndex) {
						// advancedType.putter(node.get(propKey), val);
						throw new Error('`put` not implemented on advanced types with derived indices');
					} else {
						node.get(propKey).put(advancedType ? advancedType.store(val) : val);
					}
				},
			};

			methodsRef.current = methods
				? methods(getState, defaultMethods)
				: defaultMethods;
		}

		return createElement(Component, {
			...ownProps,
			'@state': convertForRender(state, schema),
			'@methods': methodsRef.current,
		});
	};
};

const convertForRender = (state, schema) => {
	let result = {};

	for (let k in state) {
		const propSchema = schema[k];
		const sType = advancedTypes[propSchema.type];

		result[k] = sType ? sType.retrieve(state[k]) : state[k];
	}

	return result;
};

const getSpecial = (propKey, schema) => {
	const propSchema = schema[propKey];
	return advancedTypes[propSchema.type];
};

export default bind;
