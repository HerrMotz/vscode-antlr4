/*
 * This file is released under the MIT license.
 * Copyright (c) 2016, 2020, Mike Lischke
 *
 * See LICENSE file for more info.
 */

import { Lexer, Token } from "antlr4ng";

import { ANTLRv4Lexer } from "./ANTLRv4Lexer.js";

export abstract class LexerAdaptor extends Lexer {
    private currentRuleType: number = Token.INVALID_TYPE;

    public override emit(): Token {
        if (this._type === ANTLRv4Lexer.ID) {
            const firstChar = this.inputStream.getText(this._tokenStartCharIndex, this._tokenStartCharIndex);
            if (firstChar.charAt(0) === firstChar.charAt(0).toUpperCase()) {
                this._type = ANTLRv4Lexer.TOKEN_REF;
            } else {
                this._type = ANTLRv4Lexer.RULE_REF;
            }

            if (this.currentRuleType === Token.INVALID_TYPE) { // if outside of rule def
                this.currentRuleType = this._type; // set to inside lexer or parser rule
            }
        } else if (this._type === ANTLRv4Lexer.SEMI) { // exit rule def
            this.currentRuleType = Token.INVALID_TYPE;
        }

        return super.emit();
    }

    protected handleBeginArgument(): void {
        if (this.currentRuleType === ANTLRv4Lexer.TOKEN_REF) {
            this.pushMode(ANTLRv4Lexer.LexerCharSet);
            this.more();
        } else {
            this.pushMode(ANTLRv4Lexer.Argument);
        }
    }

    protected handleEndArgument(): void {
        this.popMode();
        // eslint-disable-next-line no-underscore-dangle
        if (this._modeStack.length > 0) {
            this._type = ANTLRv4Lexer.ARGUMENT_CONTENT;
        }
    }

    protected handleEndAction(): void {
        this.popMode();
        // eslint-disable-next-line no-underscore-dangle
        if (this._modeStack.length > 0) {
            this._type = ANTLRv4Lexer.ACTION_CONTENT;
        }
    }
}
