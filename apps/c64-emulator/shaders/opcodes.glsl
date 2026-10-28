// Generated from the documented NMOS 6502 opcode matrix. Do not edit by hand.
const uint OP_COUNT = 64u;
const uint OP_ADC = 0u;
const uint OP_AND = 1u;
const uint OP_ASL = 2u;
const uint OP_BCC = 3u;
const uint OP_BCS = 4u;
const uint OP_BEQ = 5u;
const uint OP_BIT = 6u;
const uint OP_BMI = 7u;
const uint OP_BNE = 8u;
const uint OP_BPL = 9u;
const uint OP_BRK = 10u;
const uint OP_BVC = 11u;
const uint OP_BVS = 12u;
const uint OP_CLC = 13u;
const uint OP_CLD = 14u;
const uint OP_CLI = 15u;
const uint OP_CLV = 16u;
const uint OP_CMP = 17u;
const uint OP_CPX = 18u;
const uint OP_CPY = 19u;
const uint OP_DCP = 20u;
const uint OP_DEC = 21u;
const uint OP_DEX = 22u;
const uint OP_DEY = 23u;
const uint OP_EOR = 24u;
const uint OP_INC = 25u;
const uint OP_INX = 26u;
const uint OP_INY = 27u;
const uint OP_ISB = 28u;
const uint OP_JMP = 29u;
const uint OP_JSR = 30u;
const uint OP_LAX = 31u;
const uint OP_LDA = 32u;
const uint OP_LDX = 33u;
const uint OP_LDY = 34u;
const uint OP_LSR = 35u;
const uint OP_NOP = 36u;
const uint OP_ORA = 37u;
const uint OP_PHA = 38u;
const uint OP_PHP = 39u;
const uint OP_PLA = 40u;
const uint OP_PLP = 41u;
const uint OP_RLA = 42u;
const uint OP_ROL = 43u;
const uint OP_ROR = 44u;
const uint OP_RRA = 45u;
const uint OP_RTI = 46u;
const uint OP_RTS = 47u;
const uint OP_SAX = 48u;
const uint OP_SBC = 49u;
const uint OP_SEC = 50u;
const uint OP_SED = 51u;
const uint OP_SEI = 52u;
const uint OP_SLO = 53u;
const uint OP_SRE = 54u;
const uint OP_STA = 55u;
const uint OP_STX = 56u;
const uint OP_STY = 57u;
const uint OP_TAX = 58u;
const uint OP_TAY = 59u;
const uint OP_TSX = 60u;
const uint OP_TXA = 61u;
const uint OP_TXS = 62u;
const uint OP_TYA = 63u;

const uint OPCODE_MODE[256] = uint[256](
    0,13,0,13,3,3,3,3,0,2,1,2,7,7,7,7,
    6,15,0,14,4,4,4,4,0,11,0,10,8,9,8,8,
    7,13,0,13,3,3,3,3,0,2,1,2,7,7,7,7,
    6,15,0,14,4,4,4,4,0,11,0,10,8,9,8,8,
    0,13,0,13,3,3,3,3,0,2,1,2,7,7,7,7,
    6,15,0,14,4,4,4,4,0,11,0,10,8,9,8,8,
    0,13,0,13,3,3,3,3,0,2,1,2,12,7,7,7,
    6,15,0,14,4,4,4,4,0,11,0,10,8,9,8,8,
    2,13,2,13,3,3,3,3,0,2,0,2,7,7,7,7,
    6,14,0,14,4,4,5,5,0,10,0,10,8,8,10,10,
    2,13,2,13,3,3,3,3,0,2,0,2,7,7,7,7,
    6,15,0,15,4,4,5,5,0,11,0,11,9,9,11,11,
    2,13,2,13,3,3,3,3,0,2,0,2,7,7,7,7,
    6,15,0,14,4,4,4,4,0,11,0,10,8,9,8,8,
    2,13,2,13,3,3,3,3,0,2,0,2,7,7,7,7,
    6,15,0,14,4,4,4,4,0,11,0,10,8,9,8,8
);
const uint OPCODE_OP[256] = uint[256](
    10,37,36,53,36,37,2,53,39,37,2,36,36,37,2,53,
    9,37,36,53,36,37,2,53,13,37,36,53,36,37,2,53,
    30,1,36,42,6,1,43,42,41,1,43,36,6,1,43,42,
    7,1,36,42,36,1,43,42,50,1,36,42,36,1,43,42,
    46,24,36,54,36,24,35,54,38,24,35,36,29,24,35,54,
    11,24,36,54,36,24,35,54,15,24,36,54,36,24,35,54,
    47,0,36,45,36,0,44,45,40,0,44,36,29,0,44,45,
    12,0,36,45,36,0,44,45,52,0,36,45,36,0,44,45,
    36,55,36,48,57,55,56,48,23,36,61,36,57,55,56,48,
    3,55,36,36,57,55,56,48,63,55,62,36,36,55,36,36,
    34,32,33,31,34,32,33,31,59,32,58,36,34,32,33,31,
    4,32,36,31,34,32,33,31,16,32,60,31,34,32,33,31,
    19,17,36,20,19,17,21,20,27,17,22,36,19,17,21,20,
    8,17,36,20,36,17,21,20,14,17,36,20,36,17,21,20,
    18,49,36,28,18,49,25,28,26,49,36,49,18,49,25,28,
    5,49,36,28,36,49,25,28,51,49,36,28,36,49,25,28
);
const uint OPCODE_CYCLES[256] = uint[256](
    7,6,2,8,3,3,5,5,3,2,2,2,4,4,6,6,
    2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    6,6,2,8,3,3,5,5,4,2,2,2,4,4,6,6,
    2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    6,6,2,8,3,3,5,5,3,2,2,2,3,4,6,6,
    2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    6,6,2,8,3,3,5,5,4,2,2,2,5,4,6,6,
    2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
    2,6,2,6,4,4,4,4,2,5,2,5,5,5,5,5,
    2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
    2,5,2,5,4,4,4,4,2,4,2,4,4,4,4,4,
    2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6,
    2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6,
    2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7
);
const uint MODE_IMP=0u, MODE_ACC=1u, MODE_IMM=2u, MODE_ZP=3u, MODE_ZPX=4u, MODE_ZPY=5u, MODE_REL=6u, MODE_ABS=7u, MODE_ABX=8u, MODE_ABX_P=9u, MODE_ABY=10u, MODE_ABY_P=11u, MODE_IND=12u, MODE_IZX=13u, MODE_IZY=14u, MODE_IZY_P=15u;
