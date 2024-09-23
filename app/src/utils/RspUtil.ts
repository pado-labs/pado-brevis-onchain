import { BizError, CommonResponse } from '../types';

export const buildSuccessResponse = (data: any): CommonResponse => {
    return {
        mc: 'SUCCESS',
        msg: '',
        rc: 0,
        result: data,
    };
};

export const buildFailureResponse = (bizError: BizError): CommonResponse => {
    return {
        mc: bizError.msg,
        msg: bizError.mc,
        rc: 1,
        result: undefined,
    };
};

export const buildCommonFailureResponse = (): CommonResponse => {
    return {
        mc: 'FAILED',
        msg: 'FAILED',
        rc: 1,
        result: undefined,
    };
};