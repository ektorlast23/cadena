// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract Counter {
    uint256 public x;

    event Increment(uint256 by);

    error IncrementMustBePositive();

    function inc() public {
        x += 1;
        emit Increment(1);
    }

    function incBy(uint256 by) public {
        if (by == 0) revert IncrementMustBePositive();
        x += by;
        emit Increment(by);
    }
}
