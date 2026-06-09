package main

import (
	"fmt"
	"os"
	"strings"
)

func main() {
	name := "Sandkasten"
	if len(os.Args) > 1 {
		name = strings.Join(os.Args[1:], " ")
	}
	fmt.Printf("hello, %s\n", name)
}
