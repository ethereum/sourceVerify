import React, {useEffect, useReducer} from "react";
import {verifierReducer} from "../../reducers/verifierReducer";
import {VerifierState} from "../../types";
import {
    CHAIN_OPTIONS as chainOptions,
    REPOSITORY_URL_FULL_MATCH,
    REPOSITORY_URL_PARTIAL_MATCH,
    ID_TO_CHAIN,
    CHAIN_IDS_STR
} from "../../common/constants";
import {FileUpload, AddressInput} from "./form";
import Dropdown from "../Dropdown";
import LoadingOverlay from "../LoadingOverlay";
import {useDispatchContext} from "../../state/State";
import {checkAddresses, verify, ServersideAddressCheck} from "../../api/verifier";
import Web3 from "web3-utils";
import Spinner from "../Spinner";

const initialState: VerifierState = {
    loading: false,
    address: "",
    chain: chainOptions[0],
    files: [],
    incorrectAddresses: new Set(),
    isValidationError: false,
    verifyAddressLoading: false
}

const Verifier: React.FC = () => {
    const [state, dispatch] = useReducer(verifierReducer, initialState);
    const globalDispatch = useDispatchContext();

    useEffect(() => {
        // reset values
        state.incorrectAddresses.clear();
        dispatch({type: "SET_INCORRECT_ADDRESSES", payload: state.incorrectAddresses});
        dispatch({type: "SET_VERIFY_ADDRESS_LOADING", payload: false});
        globalDispatch({type: "REMOVE_NOTIFICATION"});

        // check if input is empty
        if (state.address.length > 0) {
            const addresses = state.address.split(',');

            // check if inputted addresses are valid
            addresses.forEach(address => {
                if (!Web3.isAddress(address)) {
                    state.incorrectAddresses.add(address)
                    dispatch({type: "SET_INCORRECT_ADDRESSES", payload: state.incorrectAddresses});
                }
            });

            // check if there is any address that doesn't pass validation
            if (state.incorrectAddresses.size >= 1) {
                dispatch({type: "SET_IS_VALIDATION_ERROR", payload: true})
                return;
            }

            dispatch({type: "SET_IS_VALIDATION_ERROR", payload: false})
            dispatch({type: "SET_VERIFY_ADDRESS_LOADING", payload: true});

            checkAddresses(addresses.join(','), CHAIN_IDS_STR).then(data => {
                console.log(data.error)
                if (data.error) {
                    globalDispatch({
                        type: "SHOW_NOTIFICATION",
                        payload: {
                            type: "error",
                            content: data.error
                        }
                    });
                    return;
                }

                // if there are addresses that doesn't exist in repo
                if (data.unsuccessful.length > 0) {
                    globalDispatch({
                        type: "SHOW_NOTIFICATION",
                        payload: {
                            type: "error",
                            content: `${data.unsuccessful.join(", ")} ${data.unsuccessful.length > 1 ? "are" : "is"} not yet verified`
                        }
                    });
                } else {
                    globalDispatch({
                        type: "SHOW_NOTIFICATION",
                        payload: {
                            type: "success",
                            content: () => <div>{data.successful.map(checkResultToElement)}</div>
                        }
                    });
                }
                dispatch({type: "SET_VERIFY_ADDRESS_LOADING", payload: false});
            });
        }
    }, [state.address])

    /**
     * Sort of JSX equivalent of arr.join(sep).
     * Copied from https://stackoverflow.com/a/23619085
    */
    function intersperse(arr: any[], sep: any) {
        if (arr.length === 0) {
            return [];
        }
    
        return arr.slice(1).reduce(function(xs, x) {
            return xs.concat([sep, x]);
        }, [arr[0]]);
    }

    const checkResultToElement = (checkResult: ServersideAddressCheck) => {
        return <p key={checkResult.address}>{checkResult.address} is verified on: {
            intersperse(
                checkResult.chainIds.map(chainId => chainToLink(chainId, checkResult.address)), 
                ", "
            )
        }</p>
    }

    const chainToLink = (chainId: string, address: string): JSX.Element => {
        const chain = ID_TO_CHAIN[chainId];
        const label = chain ? chain.label : "Unknown chain";
        return <a
            target="_blank"
            rel="noopener noreferrer"
            href={`${REPOSITORY_URL_FULL_MATCH}/${chainId}/${address}`}
            style={ { wordBreak: "break-word" } }
            key={chainId}
        >{label}</a>;
    }

    const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        dispatch(
            {type: "SET_ADDRESS", payload: e.target.value}
        )
    }

    const handleFiles = (files: []) => {
        dispatch(
            {type: "SET_FILES", payload: files}
        )
    }

    const clearFiles = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>): void => {
        event.preventDefault();
        dispatch(
            {type: "CLEAR_FILES"}
        );
    }

    const handleOnSelect = (chain: any) => {
        dispatch(
            {type: "SET_CHAIN", payload: chain}
        )
    }

    const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        globalDispatch({type: "REMOVE_NOTIFICATION"});

        dispatch({type: "SET_LOADING", payload: true})

        const formData = new FormData();
        formData.append("address", state.address);
        formData.append("chain", state.chain.id.toString());

        if (state.files.length > 0) {
            state.files.forEach(file => formData.append('files', file));
        }

        const data = await verify(formData);

        if (data.error) {
            globalDispatch({type: "SHOW_NOTIFICATION", payload: {type: "error", content: data.error}});
            dispatch({type: "SET_LOADING", payload: false});
            return;
        }

        if (data.status === 'partial') {
            globalDispatch({
                type: "SHOW_NOTIFICATION", payload: {
                    type: "success",
                    content: () => <p>Contract partially verified! View the assets in the <a
                        target="_blank"
                        rel="noopener noreferrer"
                        href={`${REPOSITORY_URL_PARTIAL_MATCH}/${state.chain.id}/${data.address}`}>file explorer.</a>
                    </p>
                }
            });
            dispatch({type: "SET_LOADING", payload: false});
            return;
        }

        globalDispatch({
            type: "SHOW_NOTIFICATION", payload: {
                type: "success",
                content: () => <p>Contract successfully verified! View the assets in the <a
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`${REPOSITORY_URL_FULL_MATCH}/${state.chain.id}/${data.address}`}>file explorer.</a>
                </p>
            }
        });

        dispatch({type: "SET_LOADING", payload: false});
    }

    return (
        <div className="form-container">
            {state.loading && <LoadingOverlay/>}
            <div className="form-container__header">
                <h3>VERIFIER</h3>
            </div>
            <div className="form-container__middle">
                <form className="form" onSubmit={onSubmit}>
                    <Dropdown items={chainOptions} initialValue={chainOptions[0]} onSelect={handleOnSelect}/>
                    <div className="input-wrapper">
                        <AddressInput onChange={handleAddressChange}/>
                        {state.verifyAddressLoading && <Spinner small={true}/>}
                    </div>
                    {state.isValidationError && (() => {
                        return state.incorrectAddresses.size > 1 ?
                            <span className="validation validation--error">Some of the addresses are not valid</span> :
                            <span className="validation validation--error">Address is not valid</span>
                    })()}
                    {
                        state.files.length > 0 && <div className="form__file-upload-header">
                            <span>FILES ({state.files.length})</span>
                            <button onClick={clearFiles}>CLEAR ALL</button>
                        </div>
                    }
                    <FileUpload handleFiles={handleFiles} files={state.files}/>
                    <button type="submit"
                            className={`form__submit-btn ${!state.address ? `form__submit-btn--disabled` : ""}`}
                            disabled={!state.address}>VERIFY
                    </button>
                </form>
            </div>
        </div>
    )
}

export default Verifier;