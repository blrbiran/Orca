import {routedDispatchedRunFor, routedPersonAuthorityFor} from './commandClient.js';
import {ControlError} from './errors.js';
import {dimensions} from './commands.js';
import {agentTopUpSum, readAgentTopUpCap} from './workTopUp.js';
import type {ControlStore} from './store.js';
import type {Amount} from './types.js';

/** Both recovery commands book the same principal/cap decision in their own apply transaction. */
export function authorizeWorkTopUp(store:ControlStore,groupId:string,commandId:string,incoming:Amount,prefix:'retry-top-up'|'saved-result-top-up'):boolean {
 const dispatched=routedDispatchedRunFor(commandId);
 if(dispatched!==null)throw new ControlError(`${prefix}-dispatched-run`,dispatched);
 if(routedPersonAuthorityFor(commandId))return true;
 const cap=readAgentTopUpCap(store);
 if(cap===null)throw new ControlError(`${prefix}-not-authorized`);
 const spent=agentTopUpSum(store,groupId);
 for(const d of dimensions)if(spent[d]+incoming[d]>cap[d])throw new ControlError(`${prefix}-cap-exceeded`,d);
 return false;
}
