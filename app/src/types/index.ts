export type CommonResponse = {
    mc: string,
    msg: string,
    rc: number,
    result: any;
}

export class BizError extends Error {
    mc: string;
    msg: string;

    constructor(mc: string, msg: string) {
        super(mc);
        this.mc = mc;
        this.msg = msg;
        this.name = 'BizError';
    }
}
